// Screenshot the homepage scroll story at chosen points on its timeline.
//
// The story is a sticky stage inside a tall container, so a normal full-page
// screenshot is meaningless — it flattens the sticky element at one position.
// This scrolls to an exact progress value, waits a frame, and captures the
// VIEWPORT only, which is what a visitor actually sees at that moment.
//
// Usage: node scripts/shot-home.mjs <width> <height> <p> [p...]
//        node scripts/shot-home.mjs 1440 900 0 0.28 0.46 0.62 0.8 0.95
//        node scripts/shot-home.mjs 1440 900 below     (past the story)
const BASE = process.env.BASE || "http://127.0.0.1:4311";
const CDP = process.env.CDP || "http://127.0.0.1:9222";
import { writeFileSync, mkdirSync } from "node:fs";
mkdirSync(".screens", { recursive: true });

const [w, h, ...points] = process.argv.slice(2);
const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const events = [];
let id = 0;
await new Promise((r) => { ws.onopen = r; });
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); }
  else if (d.method) events.push(d);
};
const send = (method, params = {}) =>
  new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 900 });
await send("Page.navigate", { url: BASE + "/" });
const t0 = Date.now();
while (Date.now() - t0 < 20000 && !events.some((e) => e.method === "Page.loadEventFired")) await new Promise((r) => setTimeout(r, 100));
await new Promise((r) => setTimeout(r, 1500));

for (const point of points) {
  const expr =
    point === "below"
      ? `(()=>{const s=document.querySelector('.story');window.scrollTo(0,s.offsetTop+s.offsetHeight-1);return 'below';})()`
      : `(()=>{const s=document.querySelector('.story');const travel=s.offsetHeight-window.innerHeight;
           window.scrollTo(0,Math.round(s.offsetTop+travel*${Number(point)}));
           const st=document.querySelector('.story-stage');
           return st.style.getPropertyValue('--p')||'no-p';})()`;
  const r = await send("Runtime.evaluate", { returnByValue: true, expression: expr });
  // Two frames: one for the scroll listener, one for the paint it triggers.
  await new Promise((r) => setTimeout(r, 700));
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const name = `.screens/home-${w}-${String(point).replace(".", "_")}.png`;
  writeFileSync(name, Buffer.from(shot.data, "base64"));
  console.log(`${name}   --p=${r.result.value}`);
}

const errs = events
  .filter((e) => e.method === "Runtime.exceptionThrown" || (e.method === "Runtime.consoleAPICalled" && e.params.type === "error"))
  .map((e) => e.params?.exceptionDetails?.text || (e.params?.args || []).map((a) => a.value).join(" "))
  .filter(Boolean);
console.log(errs.length ? `CONSOLE ERRORS: ${errs.slice(0, 3).join(" | ")}` : "no console errors");
ws.close();
await fetch(`${CDP}/json/close/${target.id}`);
