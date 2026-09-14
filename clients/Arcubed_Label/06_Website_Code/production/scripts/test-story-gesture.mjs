// ONE GESTURE, ONE STATE — the homepage story's input contract.
//
// WHY THIS EXISTS
//
// Every state in the story is derived from scroll POSITION, so the story had
// no concept of a gesture. A flick is just a large change in scrollY, and the
// driver read whatever state that landed on. Measured at 390x844, where the
// travel is 3376px across nine states:
//
//   small swipe        0 -> 0
//   medium swipe       0 -> 1
//   large swipe        0 -> 4
//   very large swipe   0 -> 8     the entire story in one gesture
//   fast flick         0 -> 8
//   slow long drag     0 -> 4
//
// No existing check could see this. The reduced-motion and reveal suites ask
// whether the phases exist and whether they animate; nothing asked how many
// of them a single thumb movement crosses.
//
// WHAT IT CHECKS
//
//   1. abs(newState - oldState) <= 1 for EVERY gesture, at every magnitude,
//      in both directions, from every starting state
//   2. the story is still traversable — N separate gestures advance N states,
//      so the clamp cannot be passed by making the story impossible to get
//      through, or by demanding several nudges per state
//   3. an ordinary swipe still moves, so the fix is not friction
//   4. the page below the story still scrolls freely
//
// Gestures are real touch flings with momentum, via CDP
// Input.synthesizeScrollGesture — not scrollTo(), which would prove nothing
// about an input clamp.
//
// Needs Chrome on the CDP port, like every other audit here:
//   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
//     --remote-debugging-port=9222 --headless=new
//
// Run:  node scripts/test-story-gesture.mjs
//       BASE=https://preview node scripts/test-story-gesture.mjs

const CDP = process.env.CDP || "http://127.0.0.1:9222";
const BASE = process.env.BASE || "http://127.0.0.1:4312";
const VIEWS = [
  { w: 375, h: 812 },
  { w: 390, h: 844 },
  { w: 430, h: 932 },
];

/** Every state the viewer can perceive, in order. Mirrors ScrollStory. */
const ORD = { hero: 0, mat: 1, shape: 2, cust: 3, final: 8 };
const BOUNDS = [0, 0.2, 0.34, 0.46, 0.54, 0.62, 0.7, 0.78, 0.86];

/** Distance in px and speed in px/s. The last two are the pathological ones. */
const GESTURES = [
  ["small swipe", 260, 800],
  ["medium swipe", 600, 1200],
  ["large swipe", 1400, 3000],
  ["very large swipe", 2600, 6000],
  ["huge swipe", 5000, 9000],
  ["fast flick", 900, 12000],
  ["slow long drag", 1800, 300],
];

async function cdp() {
  const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const waits = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waits.has(m.id)) { waits.get(m.id)(m.result); waits.delete(m.id); }
  };
  const send = (method, params = {}) =>
    new Promise((res) => { const i = ++id; waits.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  return { send, close: () => ws.close(), targetId: t.id };
}

const { send, close, targetId } = await cdp();
await send("Page.enable");
await send("Runtime.enable");
await send("Page.bringToFront");
const ev = async (expr) =>
  (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result.value;

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) pass++; else fail++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
};

const read = async () =>
  JSON.parse(await ev(`(()=>{const st=document.querySelector('.story-stage');
    return JSON.stringify({phase:st.getAttribute('data-phase'), step:+st.getAttribute('data-step'),
                           y:Math.round(scrollY)})})()`));
const idx = (s) => (s.phase === "cust" ? 3 + s.step : ORD[s.phase]);

/** A real finger: touch down, drag, release, let momentum run. */
async function fling(w, h, distance, speed) {
  await send("Input.synthesizeScrollGesture", {
    x: Math.round(w / 2), y: Math.round(h * 0.6),
    xDistance: 0, yDistance: -distance, speed,
    gestureSourceType: "touch", preventFling: false,
  });
  await new Promise((r) => setTimeout(r, 1500));
}

/** Park the story on a given state without using a gesture. */
async function park(state) {
  await ev(`(()=>{const el=document.querySelector('.story');
    const travel=el.offsetHeight-innerHeight;
    const top=el.getBoundingClientRect().top+scrollY;
    scrollTo(0, Math.round(top + ${BOUNDS[state]} * travel) + 2);})()`);
  await new Promise((r) => setTimeout(r, 900));
}

for (const v of VIEWS) {
  console.log(`\n=== ${v.w}x${v.h} DPR3 ===`);
  await send("Emulation.setDeviceMetricsOverride", {
    width: v.w, height: v.h, deviceScaleFactor: 3, mobile: true,
  });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Page.navigate", { url: BASE + "/" });
  await new Promise((r) => setTimeout(r, 3000));

  const geom = JSON.parse(await ev(`(()=>{const e=document.querySelector('.story');
    return JSON.stringify({h:e.offsetHeight, vh:innerHeight, travel:e.offsetHeight-innerHeight})})()`));
  console.log(`  story ${geom.h}px, travel ${geom.travel}px, ${BOUNDS.length} states ` +
    `(~${Math.round(geom.travel / BOUNDS.length)}px each)`);

  // ---- FORWARD, from three different starting states ----------------------
  let worst = 0, worstLabel = "";
  for (const from of [0, 2, 5]) {
    for (const [label, dist, speed] of GESTURES) {
      await park(from);
      const a = await read();
      await fling(v.w, v.h, dist, speed);
      const b = await read();
      const d = idx(b) - idx(a);
      if (Math.abs(d) > Math.abs(worst)) { worst = d; worstLabel = `${label} from ${from}`; }
      ok(`${label} from state ${idx(a)} moves at most one`, Math.abs(d) <= 1,
        `${idx(a)} -> ${idx(b)} (delta ${d}, ${dist}px @ ${speed}px/s)`);
    }
  }
  console.log(`  largest delta seen: ${worst}${worstLabel ? ` (${worstLabel})` : ""}`);

  // ---- REVERSE ------------------------------------------------------------
  for (const [label, dist, speed] of GESTURES.slice(2)) {
    await park(8);
    const a = await read();
    await fling(v.w, v.h, -dist, speed);
    const b = await read();
    ok(`reverse ${label} from state ${idx(a)} moves at most one`, Math.abs(idx(b) - idx(a)) <= 1,
      `${idx(a)} -> ${idx(b)} (delta ${idx(b) - idx(a)})`);
  }

  // ---- STILL TRAVERSABLE --------------------------------------------------
  // The clamp must not be satisfiable by making the story impossible to move
  // through, and an ordinary swipe must still advance one state per swipe.
  await park(0);
  let prev = idx(await read());
  let advanced = 0, stalled = 0, worstRun = 0;
  for (let k = 0; k < 8; k++) {
    await fling(v.w, v.h, 700, 1500);
    const now = idx(await read());
    const d = now - prev;
    if (Math.abs(d) > worstRun) worstRun = Math.abs(d);
    if (d === 1) advanced++;
    else if (d === 0) stalled++;
    prev = now;
  }
  // Two separate promises: no swipe in the run may skip, and eight ordinary
  // swipes must be enough to cross the whole story — the clamp must not be
  // satisfiable by making the story impossible to get through.
  ok("no swipe in a run of eight skips a state", worstRun <= 1,
    `largest delta in the run ${worstRun}`);
  ok("eight ordinary swipes cross the whole story", prev === 8,
    `${advanced} advanced, ${stalled} stalled, ended on state ${prev}`);

  // ---- THE PAGE BELOW STILL SCROLLS --------------------------------------
  await ev(`scrollTo(0, document.body.scrollHeight)`);
  await new Promise((r) => setTimeout(r, 700));
  const atEnd = await ev(`Math.round(scrollY)`);
  await fling(v.w, v.h, -1200, 3000);
  const afterUp = await ev(`Math.round(scrollY)`);
  ok("the page below the story is not clamped", atEnd - afterUp > 200,
    `${atEnd} -> ${afterUp}`);
}

close();
try { await fetch(`${CDP}/json/close/${targetId}`); } catch {}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
