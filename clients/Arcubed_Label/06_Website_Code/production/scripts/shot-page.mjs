// Full-page screenshot of one route, after walking it so lazy images decode.
// Usage: node scripts/shot-page.mjs <route> <width> <height> <outfile>
const CDP = process.env.CDP || "http://127.0.0.1:9222";
const BASE = process.env.BASE || "http://127.0.0.1:4311";
import { writeFileSync } from "node:fs";
const [route, W, H, out] = process.argv.slice(2);
const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
const pending = new Map(); const events = []; let id = 0;
await new Promise((r) => { ws.onopen = r; });
ws.onmessage = (m) => { const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); } else if (d.method) events.push(d); };
const send = (m, p = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
// Never read a stale derivative: a browser cache hit is what made an earlier
// visual check disagree with what the page actually renders.
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: +W, height: +H, deviceScaleFactor: 1, mobile: +W < 900 });
await send("Page.navigate", { url: BASE + route });
const t0 = Date.now();
while (Date.now() - t0 < 20000 && !events.some((e) => e.method === "Page.loadEventFired")) await new Promise((r) => setTimeout(r, 100));
await new Promise((r) => setTimeout(r, 900));
await send("Runtime.evaluate", { expression: `(async()=>{const h=document.documentElement.scrollHeight;for(let y=0;y<h;y+=window.innerHeight*0.5){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,170));}window.scrollTo(0,0);})()`, awaitPromise: true });
await new Promise((r) => setTimeout(r, 1400));
const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
writeFileSync(out, Buffer.from(s.data, "base64"));
console.log("saved", out);
ws.close(); await fetch(`${CDP}/json/close/${t.id}`);
