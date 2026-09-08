// How many real wheel gestures does the story cost? Dispatches actual
// Input.dispatchMouseEvent wheel events of a typical trackpad delta and counts
// how many it takes to move from one phase to the next, so "too long" is a
// number of gestures rather than a feeling.
// Base URL: an explicit argument wins, then $BASE, then the default.
// This used to read $BASE only, so `node <script> http://localhost:3000`
// silently tested whatever stale server was on the default port.
const BASE = process.argv[2]?.startsWith("http") ? process.argv[2] : (process.env.BASE || "http://127.0.0.1:4311");
const CDP = "http://127.0.0.1:9222";
const DELTA = Number(process.env.DELTA || 120);   // one notch / firm trackpad flick
const W = Number(process.env.W || 1440), H = Number(process.env.H || 900);

const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); const pending = new Map(); let id = 0;
await new Promise((r) => { ws.onopen = r; });
ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x.result); pending.delete(x.id); } };
const send = (m, p = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: BASE + "/" }); await new Promise((r) => setTimeout(r, 3000));

const geom = await ev(`(()=>{const s=document.querySelector('.story');return JSON.stringify({top:s.offsetTop,h:s.offsetHeight,vh:innerHeight,travel:s.offsetHeight-innerHeight})})()`);
const g = JSON.parse(geom);
console.log(`story height ${g.h}px = ${(g.h / g.vh * 100).toFixed(0)}vh | scrollable travel ${g.travel}px`);

await ev(`scrollTo(0,${g.top});`); await new Promise((r) => setTimeout(r, 400));
const PHASES = [["hero",0.05],["enter",0.24],["material",0.45],["shape",0.63],["custom",0.87],["final",1.0]];
let gestures = 0, prev = 0, pi = 0;
for (let i = 0; i < 400; i++) {
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: W/2, y: H/2, deltaX: 0, deltaY: DELTA });
  gestures++;
  await new Promise((r) => setTimeout(r, 16));
  const p = await ev(`(()=>{const s=document.querySelector('.story');return Math.min(1,Math.max(0,(scrollY-s.offsetTop)/(s.offsetHeight-innerHeight)))})()`);
  while (pi < PHASES.length && p >= PHASES[pi][1] - 0.001) {
    console.log(`  ${PHASES[pi][0].padEnd(9)} ends at p=${PHASES[pi][1].toFixed(2)}  after ${gestures - prev} gestures (cumulative ${gestures})`);
    prev = gestures; pi++;
  }
  if (p >= 0.999) break;
}
console.log(`\nTOTAL ${gestures} wheel gestures of ${DELTA}px to cross the whole story (${PHASES.length} phases).`);
console.log(`Average ${(gestures / PHASES.length).toFixed(1)} gestures per phase.`);
ws.close(); await fetch(`${CDP}/json/close/${t.id}`);
