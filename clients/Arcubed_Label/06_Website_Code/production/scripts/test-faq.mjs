// FAQ — accordion behaviour AND the thing that actually went wrong, which
// was that the page stopped being Arcubed.
//
// WHY THIS EXISTS
//
// /faq passed every check in this folder while looking, in the client's
// words, like "a generic all-white page". Nothing was broken: the accordions
// worked, the anchors resolved, contrast passed, no image was upscaled. The
// page had simply lost the brand — no pink anywhere, a grey rule system, and
// a repeated macro at the top standing in for a design. None of that is
// visible to a test that only asks whether things function.
//
// So this checks both halves:
//
//   BEHAVIOUR  real touch taps open and close each answer, one at a time,
//              the marker flips, keyboard reaches every summary, and every
//              group anchor lands its heading below the sticky header
//   IDENTITY   the intro sits on the brand pink, an OPEN answer sits on the
//              brand pink, every rule and every piece of type is navy, and
//              answer text clears AA on both grounds it can appear over
//
// Needs Chrome on the CDP port:
//   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
//     --remote-debugging-port=9222 --headless=new
//
// Run:  node scripts/test-faq.mjs
//       BASE=https://preview node scripts/test-faq.mjs

const CDP = process.env.CDP || "http://127.0.0.1:9222";
const BASE = process.env.BASE || "http://127.0.0.1:4311";
const VIEWS = [
  { w: 390, h: 844, mobile: true },
  { w: 430, h: 932, mobile: true },
  { w: 1440, h: 900, mobile: false },
];

const PINK = "rgb(255, 224, 253)";
const NAVY = [20, 53, 98];

function rgb(str) {
  const m = str.match(/\d+/g);
  return m ? m.slice(0, 3).map(Number) : [255, 255, 255];
}
function lum([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** Navy-family: hue is navy, whatever the tint. Catches a stray warm grey. */
function isNavyish([r, g, b]) {
  return b > r && b >= g && b - r > 12;
}

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
const ev = async (expr) =>
  (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result.value;

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) pass++; else fail++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
};

async function tap(x, y) {
  const p = [{ x, y, radiusX: 10, radiusY: 10, force: 1 }];
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: p });
  await new Promise((r) => setTimeout(r, 40));
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await new Promise((r) => setTimeout(r, 300));
}

for (const v of VIEWS) {
  console.log(`\n=== /faq @ ${v.w} ===`);
  await send("Emulation.setDeviceMetricsOverride", {
    width: v.w, height: v.h, deviceScaleFactor: 2, mobile: v.mobile,
  });
  await send("Emulation.setTouchEmulationEnabled", { enabled: v.mobile, maxTouchPoints: 5 });
  await send("Page.navigate", { url: `${BASE}/faq` });
  await new Promise((r) => setTimeout(r, 2200));

  // ---- IDENTITY -----------------------------------------------------------
  ok("intro sits on the brand pink",
    (await ev(`getComputedStyle(document.querySelector('.fq-intro')).backgroundColor`)) === PINK);

  const introShare = await ev(`(()=>{const r=document.querySelector('.fq-intro').getBoundingClientRect();
    return Math.round(Math.min(r.bottom, innerHeight) / innerHeight * 100);})()`);
  ok("the pink opener is a real band, not a stripe", introShare >= 25, `${introShare}% of the first screen`);

  const title = rgb(await ev(`getComputedStyle(document.querySelector('.fq-title')).color`));
  ok("title is navy", title.join() === NAVY.join(), title.join(","));

  const labels = await ev(`JSON.stringify([...document.querySelectorAll('.fq-group-label')]
    .map(e=>[getComputedStyle(e).color, getComputedStyle(e).borderTopColor, getComputedStyle(e).fontFamily.slice(0,20)]))`);
  const parsed = JSON.parse(labels);
  ok("every group label is navy", parsed.every((p) => rgb(p[0]).join() === NAVY.join()));
  ok("every group rule is navy", parsed.every((p) => isNavyish(rgb(p[1]))), parsed[0]?.[1]);
  ok("group labels use the sans, not the display serif",
    parsed.every((p) => !/bodoni|display/i.test(p[1] + p[2])), parsed[0]?.[2]);

  const rules = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.fq .faq-list details')]
    .map(e=>getComputedStyle(e).borderTopColor))`));
  ok("answer rules are navy tinted, never a warm grey",
    rules.every((c) => { const p = rgb(c); return p[0] === p[1] && p[1] === p[2] ? false : isNavyish(p); }),
    rules[0]);

  // Not a pink page either: the reading surface has to stay white.
  ok("the answers are still on white",
    (await ev(`getComputedStyle(document.querySelector('.fq-body')).backgroundColor`)).match(/rgba\(0, 0, 0, 0\)|rgb\(255, 255, 255\)/) !== null);

  ok("no image was reintroduced to fill space",
    (await ev(`document.querySelectorAll('.fq img').length`)) === 0);

  // ---- BEHAVIOUR ----------------------------------------------------------
  const n = await ev(`document.querySelectorAll('.fq .faq-list details').length`);
  ok("every question is present", n === 6, `${n} of 6`);
  ok("none start open", (await ev(`document.querySelectorAll('.fq details[open]').length`)) === 0);

  for (let i = 0; i < n; i++) {
    await ev(`document.querySelectorAll('.fq .faq-list summary')[${i}].scrollIntoView({block:'center'})`);
    await new Promise((r) => setTimeout(r, 220));
    const b = await ev(`(()=>{const r=document.querySelectorAll('.fq .faq-list summary')[${i}].getBoundingClientRect();
      return JSON.stringify({x:r.left+30, y:r.top+r.height/2, h:r.height});})()`);
    const box = JSON.parse(b);
    if (v.mobile) {
      ok(`question ${i + 1} is a 40px+ touch target`, box.h >= 40, `${Math.round(box.h)}px`);
      await tap(box.x, box.y);
    } else {
      await ev(`document.querySelectorAll('.fq .faq-list summary')[${i}].click()`);
      await new Promise((r) => setTimeout(r, 220));
    }

    const s = JSON.parse(await ev(`(()=>{const d=document.querySelectorAll('.fq .faq-list details')[${i}];
      const cs=getComputedStyle(d);
      const p=d.querySelector('p');
      return JSON.stringify({open:d.open, bg:cs.backgroundColor,
        answer:p?getComputedStyle(p).color:null, text:(p?.textContent||"").length});})()`));
    ok(`question ${i + 1} opens`, s.open);
    ok(`question ${i + 1} reveals its answer`, s.text > 20, `${s.text} chars`);
    ok(`question ${i + 1} open state is the pink field`, s.bg === PINK, s.bg);
    if (s.answer) {
      const c = ratio(rgb(s.answer), rgb(PINK));
      ok(`question ${i + 1} answer clears AA on pink`, c >= 4.5, c.toFixed(2));
    }

    // Close it again — a details that cannot be closed is a one-way door.
    if (v.mobile) await tap(box.x, box.y);
    else await ev(`document.querySelectorAll('.fq .faq-list summary')[${i}].click()`);
    await new Promise((r) => setTimeout(r, 200));
    ok(`question ${i + 1} closes again`, !(await ev(`document.querySelectorAll('.fq .faq-list details')[${i}].open`)));
  }

  // ---- ANCHORS ------------------------------------------------------------
  const anchors = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.fq-group')].map(g=>g.id))`));
  ok("every group is anchored", anchors.length === 3 && anchors.every(Boolean), anchors.join(", "));
  for (const a of anchors) {
    await send("Page.navigate", { url: `${BASE}/faq#${a}` });
    await new Promise((r) => setTimeout(r, 1400));
    const top = await ev(`document.getElementById(${JSON.stringify(a)}).getBoundingClientRect().top`);
    const hdr = await ev(`document.querySelector('.site-header').getBoundingClientRect().height`);
    ok(`#${a} lands clear of the header`, top >= hdr - 4, `heading at ${Math.round(top)}, header ${Math.round(hdr)}`);
  }
}

// ---- REDUCED MOTION -------------------------------------------------------
console.log("\n=== prefers-reduced-motion ===");
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
await send("Page.navigate", { url: `${BASE}/faq` });
await new Promise((r) => setTimeout(r, 1600));
// Wait for the emulated media to be OBSERVABLE before asserting on it.
// Over a network origin the navigation can win the race against the
// override, and then this reports "still animates" about a page that does
// not — a false failure is as bad as a missed one.
for (let i = 0; i < 30; i++) {
  if (await ev(`matchMedia("(prefers-reduced-motion: reduce)").matches`)) break;
  await new Promise((r) => setTimeout(r, 200));
}
ok("reduced-motion emulation is actually in effect",
  await ev(`matchMedia("(prefers-reduced-motion: reduce)").matches`));
ok("open/close does not animate under reduced motion",
  (await ev(`getComputedStyle(document.querySelector('.fq .faq-list details')).transitionDuration`)) === "0s");
await send("Emulation.setEmulatedMedia", { features: [] });

close();
try { await fetch(`${CDP}/json/close/${targetId}`); } catch {}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
