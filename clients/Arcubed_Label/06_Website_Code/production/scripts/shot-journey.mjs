// Screenshot cart/checkout with a REAL cart, built by driving the product page
// the way a customer would. Seeding localStorage by hand would test a shape we
// invented; this tests the shape the app actually writes.
//
// Usage: node scripts/shot-journey.mjs <width> <height> [outPrefix]
const BASE = process.env.BASE || "http://127.0.0.1:4311";
const CDP = "http://127.0.0.1:9222";
import { writeFileSync, mkdirSync } from "node:fs";
mkdirSync(".screens", { recursive: true });
const [w, h, prefix = "j"] = process.argv.slice(2);

const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
const pending = new Map(); const events = []; let id = 0;
await new Promise((r) => { ws.onopen = r; });
ws.onmessage = (m) => { const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); } else if (d.method) events.push(d); };
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const evalp = async (e) => (await send("Runtime.evaluate", { returnByValue: true, expression: e, awaitPromise: true })).result?.value;
const go = async (url) => {
  await send("Page.navigate", { url });
  const t0 = Date.now();
  while (Date.now() - t0 < 15000 && !events.some((x) => x.method === "Page.loadEventFired" && !x.__s)) await new Promise((r) => setTimeout(r, 100));
  events.forEach((x) => { if (x.method === "Page.loadEventFired") x.__s = true; });
  await new Promise((r) => setTimeout(r, 1100));
};
const shot = async (name) => {
  await evalp(`(async()=>{const H=document.documentElement.scrollHeight;for(let y=0;y<H;y+=window.innerHeight*0.6){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,150));}window.scrollTo(0,0);})()`);
  await new Promise((r) => setTimeout(r, 700));
  const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  const f = `.screens/${prefix}-${name}-${w}.png`;
  writeFileSync(f, Buffer.from(s.data, "base64"));
  console.log(f);
};
const clickOpt = (group, label) => `(()=>{const g=[...document.querySelectorAll('.opt-group')].find(x=>(x.querySelector('.opt-label')||{}).textContent?.trim().toLowerCase()==='${group}');
  if(!g)return 'no-group';const b=[...g.querySelectorAll('button')].find(x=>x.textContent.trim().toLowerCase().startsWith('${label}'));
  if(!b)return 'no-opt';b.click();return 'ok';})()`;

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 900 });

// Two lines so the summary shows more than one row.
await go(`${BASE}/product/mini-luna?colour=silver-and-gold`);
await evalp(clickOpt("chain", "gold"));
await new Promise((r) => setTimeout(r, 250));
await evalp(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/add to bag/i.test(x.textContent));b&&b.click();return 'ok';})()`);
await new Promise((r) => setTimeout(r, 1500));

await go(`${BASE}/product/nova?colour=black`);
await evalp(clickOpt("strap", "crochet"));
await new Promise((r) => setTimeout(r, 250));
await evalp(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/add to bag/i.test(x.textContent));b&&b.click();return 'ok';})()`);
await new Promise((r) => setTimeout(r, 1500));

await go(`${BASE}/cart`); await shot("cart");
await go(`${BASE}/checkout`); await shot("checkout");
ws.close(); await fetch(`${CDP}/json/close/${t.id}`);
