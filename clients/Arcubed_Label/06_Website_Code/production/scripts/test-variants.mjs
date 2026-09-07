// Variant deep-link matrix.
//
// For every Shop tile: follow its link and assert the product page opened on
// the colourway that was clicked — correct product, correct swatch selected,
// and the photograph that belongs to that colour. Before variant links
// existed every tile opened on colours[0], so Silver opened Red.
//
// Usage: node scripts/test-variants.mjs
const BASE = process.env.BASE || "http://127.0.0.1:4311";
const CDP = "http://127.0.0.1:9222";
import { COLLECTION } from "../src/lib/collection.ts";
import { COLOUR_MEDIA } from "../src/lib/media-manifest.ts";
import { colourSlug } from "../src/lib/variant.ts";

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
console.log("product          colour            selected swatch     image frame     result");
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
    const res = await send("Runtime.evaluate", { returnByValue: true, expression: `(()=>{
      // Read the SEMANTIC selected state, not a CSS class: the swatch has been
      // restyled more than once and a class name is not a contract.
      const sel=[...document.querySelectorAll('.swatch-row button')].find(b=>b.getAttribute('aria-pressed')==='true');
      const img=document.querySelector('.pg-img');
      const src=img?decodeURIComponent(img.currentSrc):'';
      const m=src.match(/DSC\\d+/);
      return { h1:(document.querySelector('.pd-h1')||{}).textContent||'',
               swatch:(sel?(sel.getAttribute('aria-label')||sel.textContent):'').trim(),
               frame:m?m[0]:null };})()` });
    return res.result.value;
  });
  const okProduct = r.h1.trim().toLowerCase() === e.product.toLowerCase();
  const okSwatch = r.swatch.toLowerCase().includes(e.colour.toLowerCase());
  const okFrame = expectFrames.length === 0 || expectFrames.includes(r.frame);
  const ok = okProduct && okSwatch && okFrame;
  ok ? pass++ : fail++;
  console.log(
    `${e.product.padEnd(16)} ${e.colour.padEnd(17)} ${String(r.swatch).slice(0,18).padEnd(19)} ${String(r.frame).padEnd(15)} ` +
    (ok ? "PASS" : `FAIL${okProduct ? "" : " product"}${okSwatch ? "" : " swatch"}${okFrame ? "" : ` frame(want ${expectFrames.join("/")})`}`)
  );
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
