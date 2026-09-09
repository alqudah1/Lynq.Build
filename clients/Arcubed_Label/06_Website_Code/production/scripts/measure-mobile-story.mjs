// Measures the homepage story with REAL touch swipes, not scrollTop writes.
//
// Uses Input.synthesizeScrollGesture with gestureSourceType "touch", so the
// browser runs its own touch scrolling path. Each swipe is a fixed finger
// travel; the script records how much the page actually moved, which phase is
// on screen after it settles, and (optionally) a frame, so "phases are being
// skipped" becomes a table instead of an impression.
//
// Usage: node scripts/measure-mobile-story.mjs <base> [--shots DIR]
const BASE = process.argv[2]?.startsWith("http") ? process.argv[2] : (process.env.BASE || "http://127.0.0.1:4311");
const CDP = "http://127.0.0.1:9222";
const SHOTS = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;
const SIZES = (process.env.SIZES || "375x812,390x844,430x932,768x1024").split(",").map(s => s.split("x").map(Number));
// One "swipe": a firm thumb flick. Finger travel, in CSS px, at a normal speed.
const SWIPE = Number(process.env.SWIPE || 320);
const SPEED = Number(process.env.SPEED || 900);
const MAX = Number(process.env.MAX || 40);
import { writeFileSync, mkdirSync } from "node:fs";

// Must mirror MOBILE_BANDS in src/components/home/ScrollStory.tsx.
const PHASES = [["hero", 0, 0.05], ["enter", 0.05, 0.26], ["material", 0.26, 0.45],
                ["shape", 0.45, 0.62], ["custom", 0.62, 0.86], ["closing", 0.86, 1.0]];
const phaseAt = (p) => (PHASES.find(([, a, b]) => p >= a && p < b) || PHASES[PHASES.length - 1])[0];

const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); const pending = new Map(); let id = 0;
await new Promise(r => { ws.onopen = r; });
ws.onmessage = m => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x.result); pending.delete(x.id); } };
const send = (m, p = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const ev = async e => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

for (const [w, h] of SIZES) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Page.navigate", { url: BASE + "/" });
  await new Promise(r => setTimeout(r, 3200));

  const geom = JSON.parse(await ev(`(()=>{const s=document.querySelector('.story');
    return JSON.stringify({storyH:s.offsetHeight, vh:innerHeight, travel:s.offsetHeight-innerHeight, top:s.offsetTop,
      docH:document.documentElement.scrollHeight})})()`));
  console.log(`\n=== ${w}x${h} ===`);
  console.log(`story ${geom.storyH}px (${(geom.storyH / geom.vh * 100).toFixed(0)}vh) | travel ${geom.travel}px | page ${geom.docH}px`);

  const seen = new Map(); let prevY = 0; let deltas = [];
  for (let i = 0; i <= MAX; i++) {
    const st = JSON.parse(await ev(`(()=>{const s=document.querySelector('.story');
      const travel=s.offsetHeight-innerHeight;
      const p=Math.min(1,Math.max(0,-s.getBoundingClientRect().top/travel));
      return JSON.stringify({y:Math.round(scrollY),p:+p.toFixed(4),
        past: scrollY > s.offsetTop+travel+2})})()`));
    const ph = st.past ? "collection" : phaseAt(st.p);
    seen.set(ph, (seen.get(ph) || 0) + 1);
    if (i > 0) deltas.push(st.y - prevY);
    if (SHOTS) {
      const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeFileSync(`${SHOTS}/${w}-swipe${String(i).padStart(2, "0")}-${ph}.png`, Buffer.from(r.data, "base64"));
    }
    prevY = st.y;
    if (st.past && i > 1) break;
    await send("Input.synthesizeScrollGesture", {
      x: Math.round(w / 2), y: Math.round(h * 0.62),
      yDistance: -SWIPE, speed: SPEED, gestureSourceType: "touch",
    });
    await new Promise(r => setTimeout(r, 520));
  }
  const avg = deltas.length ? Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length) : 0;
  console.log(`one swipe (${SWIPE}px finger @ ${SPEED}px/s) scrolls ~${avg}px  => ${(geom.travel / avg).toFixed(1)} swipes across the story`);
  const total = geom.travel / avg;
  console.log("phase           dwell        px      landed on");
  for (const [name, a, b] of PHASES) {
    const dw = (b - a) * total, px = Math.round((b - a) * geom.travel);
    const n = seen.get(name) || 0;
    const flag = n === 0 ? "  SKIPPED — never the visible frame" : `  ${n} swipe${n === 1 ? "" : "s"}`;
    console.log(`  ${name.padEnd(11)} ${dw.toFixed(2).padStart(5)} swipes ${String(px).padStart(5)}px${flag}`);
  }
  const c = seen.get("collection") || 0;
  console.log(`  collection  ${c === 0 ? "NEVER REACHED" : c + " swipe(s) after release"}`);
}
ws.close(); await fetch(`${CDP}/json/close/${t.id}`);
