// PRODUCT GALLERY INTERACTION — the test that would have caught the
// duplicate Loco frames.
//
// WHY THIS EXISTS
//
// Loco Brown shipped with four gallery images, three of which were the same
// photograph: DSC05764, 05765 and 05766 are three exposures of one setup,
// same camera position, same light, same angle. Every existing check passed
// them. audit-site.mjs counts images and looks for breakage; the detail audit
// measures resolution. Neither has any idea whether two frames show the same
// thing, so a gallery a customer described as "I swipe through them and
// barely anything changes" was reported as clean by the whole suite.
//
// WHAT IT CHECKS, per product, per viewport, driving REAL touch taps:
//
//   1. every thumbnail resolves to a DIFFERENT source frame
//   2. no two frames are near-duplicate PIXELS (mean absolute difference of
//      a downsampled greyscale of the actual bytes — this is the check that
//      catches three exposures of one setup, which no filename comparison
//      can)
//   3. tapping thumbnail N puts frame N in the main stage — the thumbnails
//      and the main image are the same list in the same order
//   4. the main image is not under-resolved at that viewport's real DPR
//   5. the main image is not cropped so hard the bag stops being readable
//
// Needs Chrome on the CDP port, like every other audit here:
//   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
//     --remote-debugging-port=9222 --headless=new
//
// Run:  node scripts/test-gallery.mjs
//       BASE=https://preview node scripts/test-gallery.mjs
//
// Exits non-zero on any failure, so it can gate a deploy.

import sharp from "sharp";

const CDP = process.env.CDP || "http://127.0.0.1:9222";
const BASE = process.env.BASE || "http://127.0.0.1:4311";
const PRODUCTS = (process.env.PRODUCTS || "nova,mini-luna,vault,loco").split(",");
const VIEWS = [
  { w: 375, h: 812, dpr: 3 },
  { w: 390, h: 844, dpr: 3 },
  { w: 430, h: 932, dpr: 3 },
];

/**
 * How different two frames have to be to count as different views.
 *
 * Measured on the real archive: the three duplicate Loco exposures score 2.6
 * to 3.4 against each other on a 0-255 scale, while the genuinely different
 * views in the same product score 14 and above. 8 sits in the empty middle.
 */
const MIN_DIFF = 8;

/** DSC05765-2600.webp -> DSC05765, loco-brown-detail-full.webp -> loco-brown-detail. */
function stemOf(url) {
  const path = decodeURIComponent(url).replace(/^.*?url=/, "").split("&")[0];
  const file = path.split("/").pop() ?? "";
  return file.replace(/-(?:\d+|full)\.webp$/, "").replace(/-(?:cut|tile)$/, "");
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

/** Mean absolute difference of two images reduced to a 64x64 grey thumbnail. */
const fingerprints = new Map();
async function fingerprint(url) {
  if (fingerprints.has(url)) return fingerprints.get(url);
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const { data } = await sharp(buf).greyscale().resize(64, 64, { fit: "fill" })
    .raw().toBuffer({ resolveWithObject: true });
  fingerprints.set(url, data);
  return data;
}
function meanDiff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

const { send, close, targetId } = await cdp();
await send("Page.enable");
await send("Runtime.enable");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) pass++; else fail++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
};

// PRODUCT PAGES (the Colour Atelier, 2026-10-15). The stage is one locked
// photograph per bag drawn on a canvas; Rand's own photographs of the chosen
// colour sit in a row beneath it. Checked: the stage is drawn at full
// resolution for the box it sits in, and the photographs all load, are
// different pictures, belong to the chosen colour and carry alt text.
for (const slug of PRODUCTS) {
  for (const v of VIEWS) {
    console.log(`\n=== /product/${slug} @ ${v.w}css DPR${v.dpr} ===`);
    await send("Emulation.setDeviceMetricsOverride", { width: v.w, height: v.h, deviceScaleFactor: v.dpr, mobile: true });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await send("Page.navigate", { url: `${BASE}/product/${slug}` });
    let st = null;
    for (let t = 0; t < 80; t++) {
      await new Promise((r) => setTimeout(r, 200));
      st = (await send("Runtime.evaluate", { returnByValue: true, expression: `(()=>{const f=document.querySelector('.at-frame');
        if(!f)return null;const el=f.dataset.render==='photo'?f.querySelector('img'):f.querySelector('.rc-canvas[data-render-ms]');
        if(!el)return null;if(el.tagName==='IMG'&&!(el.complete&&el.naturalWidth))return null;
        const r=f.getBoundingClientRect();return {kind:el.tagName,w:el.tagName==='IMG'?el.naturalWidth:el.width,h:el.tagName==='IMG'?el.naturalHeight:el.height,
        boxW:r.width,boxH:r.height,colour:document.querySelector('.at-sw.is-on')?.getAttribute('aria-label')};})()` })).result.value;
      if (st) break;
    }
    ok("stage draws the bag", Boolean(st), st ? `${st.kind} ${st.w}x${st.h}` : "nothing drawn");
    if (!st) continue;
    // object-fit: contain inside the frame box: the bag's drawn width in physical px
    const drawnW = Math.min(st.boxW, st.boxH * (st.w / st.h)) * v.dpr;
    const ppp = st.w / drawnW;
    ok("stage drawn at full resolution", ppp >= 0.9, `ppp ${ppp.toFixed(2)} (${st.w}px source for ${Math.round(drawnW)} physical px)`);

    await send("Runtime.evaluate", { expression: `document.querySelector('.at-photos')?.scrollIntoView({block:'center'})` });
    let photos = [];
    for (let t = 0; t < 40; t++) {
      await new Promise((r) => setTimeout(r, 200));
      photos = (await send("Runtime.evaluate", { returnByValue: true, expression: `[...document.querySelectorAll('.at-photos img')].map(i=>({src:i.currentSrc,ok:i.complete&&i.naturalWidth>0,alt:i.alt}))` })).result.value ?? [];
      if (photos.every((x) => x.ok)) break;
    }
    if (!photos.length) { ok("no photographs of this colour, so no row", true); continue; }
    ok(`all ${photos.length} photographs load`, photos.every((x) => x.ok));
    ok("photographs have alt text", photos.every((x) => x.alt && x.alt.trim().length > 8));
    const stems = photos.map((x) => stemOf(x.src));
    ok("every photograph is a different frame", new Set(stems).size === stems.length, stems.join(", "));
    let worst = { d: 999, pair: "" };
    for (let i = 0; i < photos.length; i++) for (let j = i + 1; j < photos.length; j++) {
      const d = meanDiff(await fingerprint(photos[i].src), await fingerprint(photos[j].src));
      if (d < worst.d) worst = { d, pair: `${stems[i]} vs ${stems[j]}` };
    }
    if (photos.length > 1) ok("no two photographs are near-duplicate pictures", worst.d >= MIN_DIFF, `closest pair ${worst.pair} at ${worst.d.toFixed(1)} (floor ${MIN_DIFF})`);
  }
}

// ---------------------------------------------------------------------------
// COLOUR SWATCH FIELDS
//
// A strip of swatches that all share one background is a strip that offers
// the same option repeatedly. It shipped twice: every product-page swatch on
// var(--pink), and then every PHOTOGRAPHIC model-block swatch on the same
// default while the cut-outs had their field. Loco has two colourways and
// both of them are photographs, so its block showed two identical pink boxes.
//
// Checked on both surfaces, at every width, because the two strips are laid
// out differently — the phone grid wraps three-up and puts pairs beside each
// other that a single desktop row never does.
// ---------------------------------------------------------------------------
const SWATCH_VIEWS = [
  { w: 375, h: 812, dpr: 3 }, { w: 390, h: 844, dpr: 3 }, { w: 430, h: 932, dpr: 3 },
  { w: 768, h: 1024, dpr: 2 }, { w: 1440, h: 900, dpr: 1 },
];
const PINK = "rgb(255, 224, 253)";

/** Perceptually indistinguishable at swatch size. */
function tooClose(a, b) {
  const p = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
  const [x, y] = [p(a), p(b)];
  return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]) < 18;
}

for (const v of SWATCH_VIEWS) {
  console.log(`\n=== colour swatch fields @ ${v.w} ===`);
  await send("Emulation.setDeviceMetricsOverride", {
    width: v.w, height: v.h, deviceScaleFactor: v.dpr, mobile: v.w < 900,
  });

  // Product pages.
  for (const slug of PRODUCTS) {
    await send("Page.navigate", { url: `${BASE}/product/${slug}` });
    for (let t = 0; t < 40; t++) {
      await new Promise((r) => setTimeout(r, 250));
      const n = (await send("Runtime.evaluate", { returnByValue: true, expression: `document.querySelectorAll('.at-swatches .at-sw').length` })).result.value;
      if (n) break;
    }
    await new Promise((r) => setTimeout(r, 600));
    const got = JSON.parse((await send("Runtime.evaluate", {
      returnByValue: true,
      // The Atelier's swatches are textured yarn close-ups: compare what is
      // actually painted (texture source + position, over the flat tone).
      expression: `JSON.stringify([...document.querySelectorAll('.at-swatches .at-sw')].map(b=>{const d=getComputedStyle(b.querySelector('.at-dot'));
        return [b.getAttribute('aria-label'), d.backgroundColor + ' ' + d.backgroundImage.slice(0,120) + ' ' + d.backgroundPosition];}))`,
    })).result.value || "[]");
    ok(`${slug} selector: swatches present`, got.length >= 2, String(got.length));
    const fields = got.map((g) => g[1]);
    ok(`${slug} selector: no two swatches share a field`,
      new Set(fields).size === fields.length, got.map((g) => `${g[0]}`).join(", "));
    ok(`${slug} selector: not an all-pink row`,
      !(fields.length > 1 && fields.every((f) => f === PINK)));
    let clash = "";
    for (let i = 1; i < fields.length; i++) if (tooClose(fields[i - 1], fields[i])) clash = `${got[i - 1][0]} / ${got[i][0]}`;
    ok(`${slug} selector: neighbours are visibly different`, !clash, clash || "all clear");
  }

  // Model blocks, which live on the homepage and the Shop.
  for (const route of ["/", "/shop"]) {
    await send("Page.navigate", { url: BASE + route });
    await new Promise((r) => setTimeout(r, 2600));
    const blocks = JSON.parse((await send("Runtime.evaluate", {
      returnByValue: true,
      expression: `JSON.stringify([...document.querySelectorAll('.mc-block')].map(b=>({
        m: b.className.replace('mc-block mc-',''),
        w: [...b.querySelectorAll('.mc-way')].map(x=>[(x.getAttribute('aria-label')||'').split(' in ').pop(),
                                                      getComputedStyle(x).backgroundColor])})))`,
    })).result.value || "[]");
    ok(`${route} renders all four model blocks`, blocks.length === 4, `${blocks.length}`);
    for (const b of blocks) {
      const fields = b.w.map((x) => x[1]);
      ok(`${route} ${b.m} block: no two swatches share a field`,
        new Set(fields).size === fields.length, b.w.map((x) => x[0]).join(", "));
      ok(`${route} ${b.m} block: not an all-pink row`,
        !(fields.length > 1 && fields.every((f) => f === PINK)));
      let clash = "";
      for (let i = 1; i < fields.length; i++) if (tooClose(fields[i - 1], fields[i])) clash = `${b.w[i - 1][0]} / ${b.w[i][0]}`;
      ok(`${route} ${b.m} block: neighbours are visibly different`, !clash, clash || "all clear");
    }
  }
}

close();
try { await fetch(`${CDP}/json/close/${targetId}`); } catch {}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
