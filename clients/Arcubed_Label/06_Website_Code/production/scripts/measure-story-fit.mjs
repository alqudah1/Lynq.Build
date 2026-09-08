// Measures every display line in the scroll story against the viewport at a
// range of widths. A line that starts left of 0 or ends past the viewport is
// reported with the exact overflow in pixels, so "it looks clipped" becomes a
// number instead of an opinion.
// Base URL: an explicit argument wins, then $BASE, then the default.
// This used to read $BASE only, so `node <script> http://localhost:3000`
// silently tested whatever stale server was on the default port.
const BASE = process.argv[2]?.startsWith("http") ? process.argv[2] : (process.env.BASE || "http://127.0.0.1:4311");
const CDP = process.env.CDP || "http://127.0.0.1:9222";
const WIDTHS = (process.env.WIDTHS || "1280,1440,1600,1920").split(",").map(Number);
const POINTS = [0.02, 0.15, 0.34, 0.54, 0.75, 0.94];
const SEL = ".final-line, .cust-word li, .cust-head, .mat-note, .shape-item, .story-lede, .hero-line";

const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let id = 0;
await new Promise((r) => { ws.onopen = r; });
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); } };
const send = (m, p = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
await send("Page.enable"); await send("Runtime.enable");

let bad = 0, seen = 0;
for (const w of WIDTHS) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${BASE}/` });
  await new Promise((r) => setTimeout(r, 2600));
  for (const p of POINTS) {
    await ev(`(()=>{const s=document.querySelector('.story');const h=s.offsetHeight-innerHeight;scrollTo(0,s.offsetTop+h*${p});return 1})()`);
    await new Promise((r) => setTimeout(r, 420));
    const rows = await ev(`(()=>[...document.querySelectorAll(${JSON.stringify(SEL)})]
      .filter(e=>{const r=e.getBoundingClientRect();const st=getComputedStyle(e);
        return r.width>0&&r.height>0&&st.visibility!=='hidden'&&parseFloat(st.opacity)>0.05;})
      .map(e=>{const r=e.getBoundingClientRect();return{
        t:(e.textContent||'').trim().slice(0,26), cls:e.className.toString().slice(0,24),
        l:Math.round(r.left), rt:Math.round(r.right), fs:Math.round(parseFloat(getComputedStyle(e).fontSize))};}))()`);
    seen += rows.length;
    for (const r of rows) {
      const overL = r.l < -1 ? Math.round(-r.l) : 0;
      const overR = r.rt > w + 1 ? Math.round(r.rt - w) : 0;
      if (overL || overR) { bad++; console.log(`  OVERFLOW ${w}px p=${p}  "${r.t}" (${r.cls}) fs=${r.fs}  left=${overL} right=${overR}`); }
    }
  }
}
console.log(`measured ${seen} visible display line(s)`);
console.log(bad === 0 ? "\nNo display line overflows the viewport at any tested width." : `\n${bad} overflowing line(s).`);
ws.close(); await fetch(`${CDP}/json/close/${target.id}`);
