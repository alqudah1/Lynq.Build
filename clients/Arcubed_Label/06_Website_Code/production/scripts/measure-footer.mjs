// Reports the footer wordmark's span against its content measure, so "use the
// full width" is a number instead of an impression.
const BASE = process.argv[2]?.startsWith("http") ? process.argv[2] : (process.env.BASE || "http://127.0.0.1:4311");
const CDP = "http://127.0.0.1:9222";
const SIZES = (process.env.SIZES || "1440x900,768x1024,375x812").split(",").map(s => s.split("x").map(Number));
const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); const pending = new Map(); let id = 0;
await new Promise(r => { ws.onopen = r; });
ws.onmessage = m => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x.result); pending.delete(x.id); } };
const send = (m, p = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const ev = async e => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
for (const [w, h] of SIZES) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 900 });
  await send("Page.navigate", { url: BASE + "/about" });
  await new Promise(r => setTimeout(r, 2600));
  await ev(`scrollTo(0, document.body.scrollHeight)`);
  await new Promise(r => setTimeout(r, 900));
  console.log(w + "x" + h, await ev(`(()=>{
    const ft=document.querySelector('.ft'), mk=document.querySelector('.ft-mark'),
          cols=document.querySelector('.ft-cols'), lg=document.querySelector('.ft-legal');
    if(!ft||!mk) return 'no footer';
    const cs=getComputedStyle(ft); const inner=ft.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);
    const r=mk.getBoundingClientRect(), cr=cols.getBoundingClientRect();
    const imgs=[...ft.querySelectorAll('img')].length;
    return JSON.stringify({inner:Math.round(inner), markW:Math.round(r.width),
      spanPct:Math.round(r.width/inner*100)+'%', fontPx:Math.round(parseFloat(getComputedStyle(mk).fontSize)),
      overflowsRight: Math.round(r.right - (ft.getBoundingClientRect().right - parseFloat(cs.paddingRight))),
      colsCols:getComputedStyle(cols).gridTemplateColumns, footerImgs:imgs,
      ftHeight:Math.round(ft.getBoundingClientRect().height), legalTop:Math.round(lg.getBoundingClientRect().top-cr.bottom)});})()`));
}
ws.close(); await fetch(`${CDP}/json/close/${t.id}`);
