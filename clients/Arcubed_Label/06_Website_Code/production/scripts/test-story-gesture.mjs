// THE HOMEPAGE STORY'S INPUT CONTRACT — no skipped state, no hijacked scroll.
//
// HISTORY, because this file has now encoded two different contracts.
//
// f704d31 asserted "one gesture may change the state by at most one, measured
// after the gesture lands". The only way to satisfy that is to hold the page
// still: the implementation capped scrollY, froze the document mid-fling and
// landed the page back inside the state it was showing. It passed 87/87 here
// and the client then reported, on a phone AND a trackpad, exactly what it
// does: "when scrolling past the 'made yours' picture, it keeps glitching and
// sending me back up to it", scrolling "not smooth at all", and colour
// changes that "send us up". Reproduced on the alias: dragged back 1130px on a
// phone swipe and 431px on six wheel notches at 1440.
//
// The test was measuring the wrong thing. What a reader must never see is a
// state SKIPPED; what a reader must never feel is the page moving on its own.
// This version asserts both, and neither can be satisfied at the other's
// expense:
//
//   1. NO SKIPPED STATE   every change of the shown state, recorded as it
//                         happens, is exactly one step
//   2. NO FLASH           every intermediate state stays on screen for at
//                         least MIN_DWELL_MS
//   3. NO SNAP-BACK       after the gesture, the page never moves against its
//                         direction — not a single pixel
//   4. NO HIJACK          the page ends where the gesture took it, and one
//                         hard flick is enough to leave the story entirely
//   5. CATCHES UP         the shown state always ends on the state the scroll
//                         position asks for
//
// Phones are driven with real touch flings (CDP Input.synthesizeScrollGesture,
// momentum included); desktops with real wheel events, including trackpad-like
// bursts of small deltas. Needs Chrome on the CDP port like every other audit:
//   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
//     --remote-debugging-port=9222 --headless=new
//
// Run:  node scripts/test-story-gesture.mjs
//       BASE=https://preview node scripts/test-story-gesture.mjs

const CDP = process.env.CDP || "http://127.0.0.1:9222";
const BASE = process.env.BASE || "http://127.0.0.1:4312";

/** Shorter than the 300ms step on purpose: timers drift under load. */
const MIN_DWELL_MS = 200;
const BOUNDS = [0, 0.2, 0.34, 0.46, 0.54, 0.62, 0.7, 0.78, 0.86];

const PHONES = [
  { w: 375, h: 812 },
  { w: 390, h: 844 },
  { w: 430, h: 932 },
];
const DESKTOPS = [
  { w: 1440, h: 900 },
  { w: 1680, h: 1050 },
];
/** [label, distance px, speed px/s] */
const FLINGS = [
  ["small swipe", 260, 800],
  ["medium swipe", 600, 1200],
  ["large swipe", 1400, 3000],
  ["huge swipe", 5000, 9000],
  ["fast flick", 900, 12000],
  ["slow long drag", 1800, 300],
];
/** [label, deltaY per event, events, ms between] */
const WHEELS = [
  ["one notch", 100, 1, 0],
  ["six notches", 120, 6, 60],
  ["trackpad burst", 40, 30, 16],
  ["big deltas", 400, 4, 80],
  ["page-down sized", 800, 1, 0],
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) pass++; else fail++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
};

/** Start recording every shown-state change and every scroll position. */
const RECORD = `(()=>{
  const st=document.querySelector('.story-stage');
  const idx=()=>st.dataset.phase==='cust'?3+(+st.dataset.step):({hero:0,mat:1,shape:2,final:8})[st.dataset.phase];
  window.__rec={states:[[performance.now(),idx()]],ys:[[performance.now(),scrollY]]};
  window.__mo=new MutationObserver(()=>{const i=idx();const s=window.__rec.states;if(s[s.length-1][1]!==i)s.push([performance.now(),i]);});
  window.__mo.observe(st,{attributes:true,attributeFilter:['data-phase','data-step']});
  window.__sc=()=>window.__rec.ys.push([performance.now(),scrollY]);
  addEventListener('scroll',window.__sc,{passive:true});
})()`;
const STOP = `(()=>{window.__mo.disconnect();removeEventListener('scroll',window.__sc);return JSON.stringify(window.__rec)})()`;

/** Where the scroll position says the story should be. */
const TARGET = `(()=>{const e=document.querySelector('.story');const top=e.getBoundingClientRect().top+scrollY;
  const tr=e.offsetHeight-innerHeight;const p=Math.min(1,Math.max(0,(scrollY-top)/tr));
  const B=${JSON.stringify(BOUNDS)};let i=0;for(let k=0;k<B.length;k++)if(p>=B[k])i=k;return i})()`;

async function park(state) {
  await ev(`(()=>{const el=document.querySelector('.story');
    const travel=el.offsetHeight-innerHeight;
    const top=el.getBoundingClientRect().top+scrollY;
    scrollTo(0, Math.round(top + ${BOUNDS[state]} * travel) + 2);})()`);
  // Let the shown state catch up to the parked position before measuring.
  await sleep(3200);
}

/** One gesture, fully recorded, with every contract checked against it. */
async function gesture(label, from, dir, run, settleMs = 3400) {
  await park(from);
  const y0 = await ev("Math.round(scrollY)");
  await ev(RECORD);
  await run();
  await sleep(settleMs);
  const rec = JSON.parse(await ev(STOP));
  const y1 = await ev("Math.round(scrollY)");
  const target = await ev(TARGET);

  const st = rec.states;
  let worstJump = 0, shortest = Infinity;
  for (let i = 1; i < st.length; i++) {
    worstJump = Math.max(worstJump, Math.abs(st[i][1] - st[i - 1][1]));
    // Dwell of every INTERMEDIATE state (not the first, not the final one).
    if (i < st.length - 1) shortest = Math.min(shortest, st[i + 1][0] - st[i][0]);
  }
  // Snap-back: any movement against the gesture direction, anywhere.
  let back = 0;
  for (let i = 1; i < rec.ys.length; i++) back = Math.min(back, (rec.ys[i][1] - rec.ys[i - 1][1]) * dir);
  const trail = st.map((s) => s[1]).join(">");

  ok(`${label} from ${from}: no state skipped`, worstJump <= 1, `shown ${trail}`);
  if (st.length > 2) ok(`${label} from ${from}: no state flashed`, shortest >= MIN_DWELL_MS, `shortest dwell ${Math.round(shortest)}ms`);
  ok(`${label} from ${from}: no snap-back`, back === 0, `moved ${-Math.round(back)}px against the gesture`);
  ok(`${label} from ${from}: page went where it was sent`, (y1 - y0) * dir > 0, `${y0} -> ${y1}`);
  ok(`${label} from ${from}: shown state caught up`, st[st.length - 1][1] === target, `shown ${st[st.length - 1][1]}, scroll says ${target}`);
  return { y0, y1 };
}

async function setView(w, h, mobile) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: mobile ? 3 : 1, mobile });
  await send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: mobile ? 5 : 0 });
  await send("Page.navigate", { url: BASE + "/" });
  await sleep(3200);
  return JSON.parse(await ev(`(()=>{const e=document.querySelector('.story');const top=Math.round(e.getBoundingClientRect().top+scrollY);
    return JSON.stringify({top, end: top+e.offsetHeight-innerHeight, travel: e.offsetHeight-innerHeight})})()`));
}

for (const v of PHONES) {
  console.log(`\n=== ${v.w}x${v.h} touch ===`);
  const g = await setView(v.w, v.h, true);
  const fling = (dist, speed) => () => send("Input.synthesizeScrollGesture", {
    x: Math.round(v.w / 2), y: Math.round(v.h * 0.6), xDistance: 0, yDistance: -dist, speed,
    gestureSourceType: "touch", preventFling: false,
  });
  for (const [label, dist, speed] of FLINGS) await gesture(label, 0, 1, fling(dist, speed));
  for (const [label, dist, speed] of FLINGS.slice(1, 4)) await gesture(`reverse ${label}`, 8, -1, fling(-dist, speed));
  // Past Made Yours and out, in one hard flick, and never pulled back.
  const out = await gesture("flick out of the story", 7, 1, fling(3000, 9000));
  ok("one flick leaves the story", out.y1 > g.end, `ended ${out.y1}, story ends ${g.end}`);
  // Repeated crossing of the Made Yours boundary, both ways.
  let crossBack = 0;
  for (let k = 0; k < 4; k++) {
    await ev(RECORD);
    await fling(k % 2 ? -700 : 700, 1500)();
    await sleep(2600);
    const rec = JSON.parse(await ev(STOP));
    for (let i = 1; i < rec.ys.length; i++) crossBack = Math.min(crossBack, (rec.ys[i][1] - rec.ys[i - 1][1]) * (k % 2 ? -1 : 1));
  }
  ok("repeated boundary crossing never pulls the page", crossBack === 0, `worst ${-Math.round(crossBack)}px`);
}

for (const v of DESKTOPS) {
  console.log(`\n=== ${v.w}x${v.h} wheel ===`);
  const g = await setView(v.w, v.h, false);
  const wheel = (dy, n, gap) => async () => {
    for (let i = 0; i < n; i++) {
      await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: Math.round(v.w / 2), y: Math.round(v.h / 2), deltaX: 0, deltaY: dy });
      if (gap) await sleep(gap);
    }
  };
  for (const [label, dy, n, gap] of WHEELS) await gesture(label, 0, 1, wheel(dy, n, gap));
  for (const [label, dy, n, gap] of WHEELS.slice(1, 4)) await gesture(`reverse ${label}`, 8, -1, wheel(-dy, n, gap));
  const out = await gesture("scroll out past Made Yours", 7, 1, wheel(400, 6, 60));
  ok("wheel leaves the story", out.y1 > g.end, `ended ${out.y1}, story ends ${g.end}`);
}

close();
try { await fetch(`${CDP}/json/close/${targetId}`); } catch {}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
