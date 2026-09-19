// Full customer journey per colourway: shop link -> product -> configure ->
// add to cart -> cart -> checkout. Asserts the configuration SURVIVES each
// hop and that the image shown always belongs to the chosen colour.
//
// Usage: node scripts/test-journey.mjs
// Base URL: an explicit argument wins, then $BASE, then the default.
// This used to read $BASE only, so `node <script> http://localhost:3000`
// silently tested whatever stale server was on the default port.
const BASE = process.argv[2]?.startsWith("http") ? process.argv[2] : (process.env.BASE || "http://127.0.0.1:4311");
const CDP = "http://127.0.0.1:9222";
import { colourSlug } from "../src/lib/variant.ts";

const CASES = [
  { slug: "mini-luna", product: "Mini Luna", colour: "Silver", size: "Small", strap: "Crochet", chain: "Gold" },
  { slug: "mini-luna", product: "Mini Luna", colour: "Silver & Gold", size: "Regular", strap: null, chain: "Silver" },
  { slug: "mini-luna", product: "Mini Luna", colour: "Black", size: "Small", strap: null, chain: null },
  { slug: "nova", product: "Nova", colour: "Gold", size: null, strap: "Crochet", chain: null },
  { slug: "vault", product: "Vault", colour: "Olive Green", size: null, strap: null, chain: null },
  { slug: "loco", product: "Loco", colour: "Burgundy", size: null, strap: null, chain: null },
];

async function session(fn) {
  const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  const pending = new Map(); const events = []; let id = 0;
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); } else if (d.method) events.push(d); };
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const go = async (url) => {
    await send("Page.navigate", { url });
    const t0 = Date.now();
    while (Date.now() - t0 < 15000 && !events.some((x) => x.method === "Page.loadEventFired" && x.__seen !== true)) await new Promise((r) => setTimeout(r, 100));
    events.forEach((x) => { if (x.method === "Page.loadEventFired") x.__seen = true; });
    await new Promise((r) => setTimeout(r, 1100));
  };
  const evalp = async (expr) => (await send("Runtime.evaluate", { returnByValue: true, expression: expr, awaitPromise: true })).result?.value;
  try { return await fn({ send, go, evalp, events }); } finally { ws.close(); await fetch(`${CDP}/json/close/${t.id}`); }
}

/** Click the option button whose visible text starts with `label`. */
const clickOpt = (group, label) => `(()=>{
  const g=[...document.querySelectorAll('.opt-group')].find(x=>(x.querySelector('.opt-label')||{}).textContent?.trim().toLowerCase()==='${group}');
  if(!g) return 'no-group';
  const b=[...g.querySelectorAll('button')].find(x=>x.textContent.trim().toLowerCase().startsWith('${label.toLowerCase()}'));
  if(!b) return 'no-option';
  b.click(); return 'ok';})()`;

let pass = 0, fail = 0;
for (const c of CASES) {
  const steps = [];
  const res = await session(async ({ go, evalp }) => {
    // Start from an empty cart. Clearing only at the END meant the first case
    // inherited whatever a previous run had left behind, and then asserted
    // against that stale line instead of its own.
    await go(`${BASE}/`);
    await evalp(`(()=>{try{localStorage.clear()}catch(e){} return 'ok'})()`);

    // 1. product page via the exact Shop link
    await go(`${BASE}/product/${c.slug}?colour=${colourSlug(c.colour)}`);
    const p = await evalp(`(()=>{const img=document.querySelector('.pg-img');
      const sel=[...document.querySelectorAll('.swatch-row button')].find(b=>b.getAttribute('aria-pressed')==='true');
      return {h1:(document.querySelector('.pd-h1')||{}).textContent,
              swatch:(sel?(sel.getAttribute('aria-label')||sel.textContent):'').trim(),
              frame:(decodeURIComponent(img?img.currentSrc:'').match(/DSC\\d+/)||[])[0]};})()`);
    steps.push(["product", p.h1?.trim() === c.product && p.swatch.toLowerCase().includes(c.colour.toLowerCase()), `${p.h1}/${p.swatch}/${p.frame}`]);

    // 2. configure
    for (const [group, label] of [["size", c.size], ["strap", c.strap], ["chain", c.chain]]) {
      if (!label) continue;
      const r = await evalp(clickOpt(group, label));
      await new Promise((r) => setTimeout(r, 220));
      steps.push([`select ${group}`, r === "ok", String(r)]);
    }
    const price = await evalp(`(document.querySelector('.pd-price')||{}).textContent`);

    // 3. add to cart
    await evalp(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/add to cart/i.test(x.textContent));if(!b)return 'no-btn';b.click();return 'ok';})()`);
    await new Promise((r) => setTimeout(r, 1400));

    // 4. cart. Wait for the lines and their images to actually be in the DOM
    // rather than for a fixed delay: on the first (cold) case the page had not
    // finished rendering when the assertions ran, which failed a journey that
    // is not actually broken.
    await go(`${BASE}/cart`);
    for (let i = 0; i < 40; i++) {
      const ready = await evalp(`(()=>{const l=document.querySelectorAll('.cart-line');
        if(!l.length) return false;
        const im=[...document.images].filter(x=>/media/.test(x.currentSrc||x.src));
        return im.length>0 && im.every(x=>x.complete);})()`);
      if (ready) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const cart = await evalp(`(()=>{
      const txt=document.body.innerText;
      const img=[...document.images].find(i=>/media/.test(i.currentSrc||i.src));
      return {text:txt.replace(/\\s+/g,' ').slice(0,600),
              frame:(decodeURIComponent(img?(img.currentSrc||img.src):'').match(/DSC\\d+/)||[])[0]};})()`);
    const inCart = (s) => cart.text.toLowerCase().includes(s.toLowerCase());
    steps.push(["cart product", inCart(c.product), ""]);
    steps.push(["cart colour", inCart(c.colour), cart.text.slice(0, 90)]);
    steps.push(["cart image = colour", cart.frame === p.frame, `${cart.frame} vs ${p.frame}`]);
    if (c.size) steps.push(["cart size", inCart(c.size), ""]);
    if (c.strap) steps.push(["cart strap", inCart(c.strap), ""]);
    if (c.chain) steps.push(["cart chain", inCart(c.chain), ""]);

    // 5. checkout
    await go(`${BASE}/checkout`);
    const co = await evalp(`document.body.innerText.replace(/\\s+/g,' ').slice(0,900)`);
    steps.push(["checkout product", co.toLowerCase().includes(c.product.toLowerCase()), ""]);
    steps.push(["checkout colour", co.toLowerCase().includes(c.colour.toLowerCase()), ""]);

    // clear for the next case
    await evalp(`(()=>{try{localStorage.clear()}catch(e){} return 'ok'})()`);
    return { price };
  });

  const bad = steps.filter((s) => !s[1]);
  bad.length ? fail++ : pass++;
  console.log(`\n${c.product} / ${c.colour}  ${bad.length ? "FAIL" : "PASS"}   price ${res.price ?? "?"}`);
  for (const [name, ok, detail] of steps) if (!ok) console.log(`    x ${name}  ${detail}`);
}
console.log(`\n${pass} journeys passed, ${fail} failed`);
