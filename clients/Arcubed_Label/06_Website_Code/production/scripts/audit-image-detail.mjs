// EFFECTIVE DETAIL AUDIT — the test that would have caught the pixelation.
//
// WHY THIS EXISTS
//
// scripts/audit-site.mjs reported "0 upscaled" on pages the client then
// photographed looking visibly soft on an iPhone. It was wrong twice over:
//
//   1. It compared CSS width to naturalWidth and passed anything <= 1.0. That
//      is DPR-blind. At DPR3 a 390 CSS px image needs 1170 PHYSICAL pixels,
//      so a 640px file scores 0.61 — "no upscale" — while delivering 55% of
//      the detail the screen can actually resolve.
//
//   2. It never accounted for the CROP. object-fit: cover throws source
//      pixels away before anything reaches the screen. The Loco product hero
//      was delivered as a perfectly respectable 1200px file and then had 51%
//      of its width discarded by a portrait window, leaving 591 source pixels
//      stretched over 1170 physical ones.
//
// This audit records the URL the browser actually selected, re-fetches that
// exact response and reads its true pixel dimensions from the file header,
// then computes SOURCE PIXELS SHOWN PER PHYSICAL DEVICE PIXEL across the
// region object-fit actually reveals.
//
//   ppp <  1.00  under-resolved: the screen resolves detail that is not there
//   ppp 1.0-1.29 adequate
//   ppp >= 1.30  generous — check you are not wasting bytes
//
// Needs Chrome on the CDP port, same as the other audits in this folder:
//   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
//     --remote-debugging-port=9222 --headless=new
//
// Run:  node scripts/audit-image-detail.mjs
//       W=430 DPR=3 H=932 node scripts/audit-image-detail.mjs
//       BASE=https://preview node scripts/audit-image-detail.mjs
//
// Exits non-zero when anything is under-resolved, so it can gate a deploy.

const CDP = process.env.CDP || "http://127.0.0.1:9222";
const BASE = process.env.BASE || "http://127.0.0.1:4312";
const W = +(process.env.W || 390);
const H = +(process.env.H || 844);
const DPR = +(process.env.DPR || 3);
const PAGES = (process.env.PAGES ||
  "/,/shop,/about,/faq,/contact,/product/nova,/product/mini-luna,/product/vault,/product/loco"
).split(",");

/** Pixel dimensions straight from the file header. No image library. */
function imageSize(buf) {
  // PNG
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47)
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  // WebP: RIFF....WEBP
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const fmt = buf.toString("ascii", 12, 16);
    if (fmt === "VP8X") return { w: (buf.readUIntLE(24, 3) & 0xffffff) + 1, h: (buf.readUIntLE(27, 3) & 0xffffff) + 1 };
    if (fmt === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (fmt === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    }
  }
  // JPEG: walk the segments to a start-of-frame
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return { w: 0, h: 0 };
}

async function cdp() {
  const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const waits = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waits.has(m.id)) { waits.get(m.id)(m.result); waits.delete(m.id); }
  };
  const send = (method, params = {}) =>
    new Promise((res) => { const i = ++id; waits.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  return { send, close: () => ws.close(), targetId: t.id };
}

const { send, close, targetId } = await cdp();
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: W, height: H, deviceScaleFactor: DPR, mobile: W < 760,
});

const seen = new Map();
async function realDims(url) {
  if (seen.has(url)) return seen.get(url);
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  const d = { ...imageSize(buf), bytes: buf.length };
  seen.set(url, d);
  return d;
}

const raw = [];
for (const path of PAGES) {
  await send("Page.navigate", { url: BASE + path });
  await new Promise((r) => setTimeout(r, 2200));
  const height = (await send("Runtime.evaluate", {
    expression: "document.documentElement.scrollHeight", returnByValue: true,
  })).result.value;
  for (let y = 0; y < height; y += Math.round(H * 0.8)) {
    await send("Runtime.evaluate", { expression: `scrollTo(0,${y})` });
    await new Promise((r) => setTimeout(r, 90));
  }
  await new Promise((r) => setTimeout(r, 900));
  const got = (await send("Runtime.evaluate", {
    returnByValue: true,
    expression: `[...document.images].filter(i=>{const b=i.getBoundingClientRect();
      return b.width>60&&b.height>60&&i.currentSrc;}).map(i=>{const b=i.getBoundingClientRect();
      return {url:i.currentSrc, cls:(i.className||"").slice(0,24),
        fit:getComputedStyle(i).objectFit, cssW:b.width, cssH:b.height};})`,
  })).result.value || [];
  for (const g of got) raw.push({ path, ...g });
}
close();
try { await fetch(`${CDP}/json/close/${targetId}`); } catch {}

const rows = [];
for (const r of raw) {
  const d = await realDims(r.url);
  const boxAR = r.cssW / r.cssH;
  const imgAR = d.w / (d.h || 1);
  let sw = d.w, sh = d.h;
  if (r.fit === "cover") { if (imgAR > boxAR) sw = d.h * boxAR; else sh = d.w / boxAR; }
  const physW = r.cssW * DPR;
  rows.push({
    ...r, realW: d.w, realH: d.h, kb: Math.round(d.bytes / 1024),
    srcVis: Math.round(sw), physW: Math.round(physW),
    ppp: +(sw / physW).toFixed(2),
    cropPct: Math.round((1 - (sw * sh) / (d.w * d.h || 1)) * 100),
  });
}
rows.sort((a, b) => a.ppp - b.ppp);

console.log(`EFFECTIVE DETAIL @ ${W}css DPR${DPR} — source px shown per PHYSICAL px`);
console.log(`<1.00 under-resolved | 1.00-1.29 adequate | >=1.30 generous\n`);
console.log(`${"ppp".padStart(5)} ${"phys".padStart(6)} ${"srcVis".padStart(7)} ${"real".padStart(11)} ${"crop%".padStart(5)} ${"kB".padStart(5)}  ${"page".padEnd(19)}class`);
for (const r of rows) {
  const flag = r.ppp < 1 ? "  <== UNDER" : r.ppp < 1.3 ? "" : "";
  console.log(`${String(r.ppp).padStart(5)} ${String(r.physW).padStart(6)} ${String(r.srcVis).padStart(7)} ${String(r.realW + "x" + r.realH).padStart(11)} ${String(r.cropPct).padStart(5)} ${String(r.kb).padStart(5)}  ${r.path.padEnd(19)}${r.cls || "-"}${flag}`);
}
const under = rows.filter((r) => r.ppp < 1);
console.log(`\n${under.length} under-resolved, ${rows.filter((r) => r.ppp >= 1 && r.ppp < 1.3).length} adequate, of ${rows.length}`);
if (under.length) {
  console.log("\nFAIL: under-resolved images read as softness on a Retina screen.");
  process.exit(1);
}
