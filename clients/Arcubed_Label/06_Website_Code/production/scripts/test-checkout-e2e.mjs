// End-to-end checkout in a real browser: product -> Add to Bag -> cart ->
// checkout -> submit -> confirmation. Clicks real controls; does not simulate.
const BASE = process.argv[2] || "http://127.0.0.1:4311";
const CDP = "http://127.0.0.1:9222";
let pass = 0, fail = 0;
const t = (n, c, d = "") => { c ? pass++ : fail++; console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${d ? "  -> " + d : ""}`); };

async function session(fn) {
  const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map(); const events = []; let id = 0;
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => { const x = JSON.parse(m.data);
    if (x.id && pending.has(x.id)) { pending.get(x.id)(x.result); pending.delete(x.id); } else if (x.method) events.push(x); };
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  try { return await fn(send, events); } finally { ws.close(); await fetch(`${CDP}/json/close/${target.id}`); }
}
const ev = async (send, expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
const go = async (send, url, ms = 2400) => { await send("Page.navigate", { url }); await new Promise((r) => setTimeout(r, ms)); };

await session(async (send, events) => {
  await send("Runtime.enable"); await send("Page.enable"); await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 950, deviceScaleFactor: 1, mobile: false });

  // ---- 1. product page: pick a colour, add to bag
  await go(send, `${BASE}/product/nova`, 3000);
  const price0 = await ev(send, `(document.querySelector('.price-inline')||{}).textContent`);
  t("nova opens at base price (no pre-added extras)", /55/.test(price0 || ""), price0);

  await ev(send, `(() => {
    const g=[...document.querySelectorAll('.opt-group')].find(x=>/^colour/i.test((x.querySelector('.opt-label')||{}).textContent||''));
    g.querySelectorAll('button')[1].click();   // Black
  })()`);
  await new Promise(r => setTimeout(r, 600));
  const blackFrame = await ev(send, `decodeURIComponent((document.querySelector('.pg-img')||{}).currentSrc||'').match(/DSC\\d+/)?.[0]`);
  t("colour click changes photo", blackFrame === "DSC05780", String(blackFrame));

  // add a paid chain to prove surcharge maths
  await ev(send, `(() => {
    const g=[...document.querySelectorAll('.opt-group')].find(x=>/^chain/i.test((x.querySelector('.opt-label')||{}).textContent||''));
    g.querySelectorAll('button')[1].click();
  })()`);
  await new Promise(r => setTimeout(r, 500));
  const price1 = await ev(send, `(document.querySelector('.price-inline')||{}).textContent`);
  t("adding a chain adds +5 (55 -> 60)", /60/.test(price1 || ""), price1);

  await ev(send, `[...document.querySelectorAll('button')].find(b=>/add to bag/i.test(b.textContent))?.click()`);
  await new Promise(r => setTimeout(r, 900));
  const count = await ev(send, `(document.querySelector('.badge')||{}).textContent`);
  t("add to bag updates cart count", (count || "").trim() === "1", count);

  // ---- 2. cart
  await go(send, `${BASE}/cart`, 2200);
  const cart = await ev(send, `(() => ({
    lines: document.querySelectorAll('.cart-line').length,
    img: !!document.querySelector('.cart-line img'),
    imgSrc: decodeURIComponent((document.querySelector('.cart-line img')||{}).currentSrc||'').match(/DSC\\d+/)?.[0]||null,
    tags: [...document.querySelectorAll('.cart-line .tag')].map(x=>x.textContent.trim()),
    hasCheckout: !!([...document.querySelectorAll('a')].find(a=>/checkout/i.test(a.textContent))),
  }))()`);
  t("cart shows the line", cart.lines === 1);
  t("cart thumbnail is the BLACK nova photo", cart.imgSrc === "DSC05780", String(cart.imgSrc));
  t("cart omits 'None' rows", !cart.tags.some(x => /none/i.test(x)), JSON.stringify(cart.tags));
  t("cart has a real checkout link", cart.hasCheckout);

  // ---- 3. checkout validation
  await go(send, `${BASE}/checkout`, 2400);
  await ev(send, `document.querySelector('.co-submit').click()`);
  await new Promise(r => setTimeout(r, 900));
  const errs = await ev(send, `[...document.querySelectorAll('.co-errors p')].map(p=>p.textContent)`);
  t("empty submit shows specific field errors", (errs || []).length >= 3, JSON.stringify((errs || []).slice(0, 2)));
  t("errors are specific, not generic", !(errs || []).some(e => /something went wrong/i.test(e)));

  const kept = await ev(send, `document.querySelector('#f-name').value`);
  t("form still usable after error", typeof kept === "string");

  // ---- 4. international -> quote required
  await ev(send, `(() => { const s=document.querySelector('#f-zone'); s.value='international';
    s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await new Promise(r => setTimeout(r, 500));
  const intl = await ev(send, `(() => ({
    shipping: [...document.querySelectorAll('.co-totals div')].map(d=>d.textContent).join(' | '),
    quoteNote: !!document.querySelector('.co-quote'),
    countryField: !!document.querySelector('#f-country'),
    btn: (document.querySelector('.co-submit')||{}).textContent,
  }))()`);
  t("international shows quote-required shipping", /quoted/i.test(intl.shipping), intl.shipping);
  t("international explains the quote", intl.quoteNote);
  t("international asks for country", intl.countryField);
  t("international CTA says 'request'", /request/i.test(intl.btn || ""), intl.btn);

  // ---- 5. valid Amman order
  await ev(send, `(() => {
    const set=(id,v)=>{const el=document.querySelector(id); const p=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set; p.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true}));};
    const s=document.querySelector('#f-zone'); s.value='amman'; s.dispatchEvent(new Event('change',{bubbles:true}));
    set('#f-name','E2E Test Order'); set('#f-phone','0790000000'); set('#f-email','e2e@example.test');
  })()`);
  await new Promise(r => setTimeout(r, 400));
  await ev(send, `(() => {
    const set=(id,v)=>{const el=document.querySelector(id); if(!el) return; const p=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set; p.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true}));};
    set('#f-city','Amman'); set('#f-address','1 Test Street');
  })()`);
  await new Promise(r => setTimeout(r, 400));
  const totals = await ev(send, `[...document.querySelectorAll('.co-totals div')].map(d=>d.textContent).join(' | ')`);
  t("amman shipping shows JOD 3", /3/.test(totals), totals);

  await ev(send, `document.querySelector('.co-submit').click()`);
  await new Promise(r => setTimeout(r, 4200));
  const after = await ev(send, `({ url: location.pathname, ref: (document.querySelector('.oc-ref strong')||{}).textContent, title: (document.querySelector('.oc-title')||{}).textContent })`);
  t("redirects to /order/<token>", /^\/order\/[0-9a-f-]{36}$/.test(after.url || ""), after.url);
  t("confirmation shows an order reference", /^AR-/.test((after.ref || "").trim()), after.ref);

  const conf = await ev(send, `(() => {
    const txt=document.body.innerText;
    return { paidClaim: /payment successful|purchase complete|paid/i.test(txt),
             noPayment: /no payment has been taken/i.test(txt),
             hasThumb: !!document.querySelector('.oc-line img'),
             total: [...document.querySelectorAll('.co-totals div')].map(d=>d.textContent).join(' | ') };
  })()`);
  t("confirmation does NOT claim payment", !conf.paidClaim);
  t("confirmation states no payment taken", conf.noPayment);
  t("confirmation shows real product thumbnail", conf.hasThumb);
  t("confirmation shows totals", /58|Total/i.test(conf.total), conf.total);

  const errCount = events.filter(e => e.method === "Runtime.exceptionThrown").length;
  t("no runtime exceptions during flow", errCount === 0, String(errCount));
});

console.log(`\n${pass} passed, ${fail} failed`);
