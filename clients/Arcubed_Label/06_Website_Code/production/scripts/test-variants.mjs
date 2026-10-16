// Variant deep-link matrix.
//
// For every Shop tile: follow its link and assert the product page opened on
// the colourway that was clicked — correct product, correct swatch selected,
// and the right picture. Before variant links existed every tile opened on
// colours[0], so Silver opened Red.
//
// The product page is the Colour Atelier (2026-10-15): the stage always shows
// the bag's LOCKED photograph (recoloured to the chosen yarn) — except a
// colour the photograph cannot show (two-tone), which shows its own
// photograph — and Rand's photographs of the chosen colour sit beneath it.
//
// Usage: node scripts/test-variants.mjs
// Base URL: an explicit argument wins, then $BASE, then the default.
// This used to read $BASE only, so `node <script> http://localhost:3000`
// silently tested whatever stale server was on the default port.
const BASE = process.argv[2]?.startsWith("http") ? process.argv[2] : (process.env.BASE || "http://127.0.0.1:4311");
const CDP = "http://127.0.0.1:9222";
import { COLLECTION } from "../src/lib/collection.ts";
import { COLOUR_MEDIA } from "../src/lib/media-manifest.ts";
import { colourSlug } from "../src/lib/variant.ts";
import { PREVIEW_SOURCES } from "../src/lib/recolour/preview-colours.ts";

async function session(fn) {
  const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  const pending = new Map(); const events = []; let id = 0;
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); } else if (d.method) events.push(d); };
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  try { return await fn(send, events); } finally { ws.close(); await fetch(`${CDP}/json/close/${t.id}`); }
}

let pass = 0, fail = 0;
console.log("product          colour            selected swatch     stage frame     result");
for (const e of COLLECTION) {
  const url = `${BASE}/product/${e.slug}?colour=${colourSlug(e.colour)}`;
  const expectFrames = (COLOUR_MEDIA[e.slug]?.[e.colour] ?? []).map((f) => f.frameId);
  const r = await session(async (send, events) => {
    await send("Page.enable"); await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url });
    const t0 = Date.now();
    while (Date.now() - t0 < 15000 && !events.some((x) => x.method === "Page.loadEventFired")) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 900));
    // Wait for the photograph this test asserts on to actually decode. A flat
    // 900ms was enough against a warm image cache and not enough when Next has
    // to generate the derivative, which reported every frame as null.
    for (let i = 0; i < 24; i++) {
      const ready = await send("Runtime.evaluate", { returnByValue: true, expression:
        `(()=>{const f=document.querySelector('.at-frame');if(!f)return false;if(f.dataset.render==='photo'){const i=f.querySelector('img');return !!(i&&i.complete&&i.naturalWidth>0)}return !!f.querySelector('.rc-canvas[data-render-ms]')})()` });
      if (ready.result?.value) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const res = await send("Runtime.evaluate", { returnByValue: true, expression: `(()=>{
      // Read the SEMANTIC selected state, not a CSS class: the swatch has been
      // restyled more than once and a class name is not a contract.
      const sel=[...document.querySelectorAll('.at-swatches button')].find(b=>b.getAttribute('aria-pressed')==='true');
      const f=document.querySelector('.at-frame');
      const photos=[...document.querySelectorAll('.at-photos img')].map(i=>decodeURIComponent(i.currentSrc||i.src));
      return { h1:(document.querySelector('h1')||{}).textContent||'',
               swatch:(sel?(sel.getAttribute('aria-label')||sel.textContent):'').trim(),
               frame:f?f.dataset.frame:null, render:f?f.dataset.render:null, photos };})()` });
    return res.result.value;
  });
  const okProduct = r.h1.trim().toLowerCase() === e.product.toLowerCase();
  const okSwatch = r.swatch.toLowerCase().includes(e.colour.toLowerCase());
  const locked = (PREVIEW_SOURCES[e.slug] ?? []).find((s) => s.locked)?.frame;
  // the stage: the locked photograph, or (two-tone) the colour's own photograph
  const okStage = r.render === "photo" ? expectFrames.includes(r.frame) : r.frame === locked && ["source", "profile", "measured"].includes(r.render);
  // beneath it: Rand's photographs of exactly this colour
  const okPhotos = expectFrames.length === 0 || (r.photos.length === expectFrames.length && r.photos.every((src) => expectFrames.some((id) => src.includes(id))));
  const okFrame = okStage && okPhotos;
  const ok = okProduct && okSwatch && okFrame;
  ok ? pass++ : fail++;
  console.log(
    `${e.product.padEnd(16)} ${e.colour.padEnd(17)} ${String(r.swatch).slice(0,18).padEnd(19)} ${String(r.frame).padEnd(15)} ` +
    (ok ? "PASS" : `FAIL${okProduct ? "" : " product"}${okSwatch ? "" : " swatch"}${okStage ? "" : ` stage(${r.render}, want ${locked})`}${okPhotos ? "" : ` photos(${r.photos.length} want ${expectFrames.join("/")})`}`)
  );
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
