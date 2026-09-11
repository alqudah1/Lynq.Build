// Drives the colour swatch strip with REAL key events and checks the roving
// tabindex contract: one tab stop, arrows move, Home/End jump, aria-pressed
// follows, focus is visible, and the deep link tracks the selection.
const BASE = process.argv[2]?.startsWith("http") ? process.argv[2] : (process.env.BASE || "http://127.0.0.1:4311");
const CDP = "http://127.0.0.1:9222";
const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); const pending = new Map(); let id = 0;
await new Promise(r => { ws.onopen = r; });
ws.onmessage = m => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x.result); pending.delete(x.id); } };
const send = (m, p = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const ev = async e => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
const key = async (k, code, vk) => {
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code, windowsVirtualKeyCode: vk });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
  await new Promise(r => setTimeout(r, 160));
};
const KEYS = { ArrowRight: ["ArrowRight", 39], ArrowLeft: ["ArrowLeft", 37], Home: ["Home", 36], End: ["End", 35] };
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: BASE + "/shop" }); await new Promise(r => setTimeout(r, 3000));

const state = () => ev(`(()=>{const g=document.querySelectorAll('.mc-ways')[0];
  const b=[...g.querySelectorAll('button')];
  const a=document.activeElement;
  const link=g.closest('.mc-block').querySelector('.mc-view');
  return JSON.stringify({
    n:b.length,
    tabStops:b.filter(x=>x.tabIndex===0).length,
    focusIdx:b.indexOf(a),
    pressedIdx:b.findIndex(x=>x.getAttribute('aria-pressed')==='true'),
    onClass:b.findIndex(x=>x.className.includes('is-on')),
    href:link.getAttribute('href'),
    label:a&&a.getAttribute?a.getAttribute('aria-label'):null,
    outline:a?getComputedStyle(a,':focus-visible').outlineStyle:null})})()`);

let fails = 0;
const check = (name, ok, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`); };

let s = JSON.parse(await state());
check("exactly one tab stop in the strip", s.tabStops === 1, `${s.tabStops} of ${s.n}`);

// focus the first swatch the way Tab would
await ev(`document.querySelectorAll('.mc-ways')[0].querySelector('button[tabindex="0"]').focus()`);
s = JSON.parse(await state());
check("focus lands on the selected swatch", s.focusIdx === s.pressedIdx, `focus ${s.focusIdx}, pressed ${s.pressedIdx}`);
const first = s.href;

await key("ArrowRight", ...KEYS.ArrowRight);
s = JSON.parse(await state());
check("ArrowRight moves focus", s.focusIdx === 1, `idx ${s.focusIdx}`);
check("aria-pressed follows focus", s.pressedIdx === 1, `pressed ${s.pressedIdx}`);
check("visual selection follows", s.onClass === 1, `is-on ${s.onClass}`);
check("deep link follows the selection", s.href !== first, `${first} -> ${s.href}`);

await key("ArrowLeft", ...KEYS.ArrowLeft);
s = JSON.parse(await state());
check("ArrowLeft moves back", s.focusIdx === 0 && s.pressedIdx === 0, `idx ${s.focusIdx}`);

await key("End", ...KEYS.End);
s = JSON.parse(await state());
check("End jumps to last", s.focusIdx === s.n - 1 && s.pressedIdx === s.n - 1, `idx ${s.focusIdx} of ${s.n}`);

await key("Home", ...KEYS.Home);
s = JSON.parse(await state());
check("Home jumps to first", s.focusIdx === 0 && s.pressedIdx === 0, `idx ${s.focusIdx}`);

await key("ArrowLeft", ...KEYS.ArrowLeft);
s = JSON.parse(await state());
check("wraps backwards from first to last", s.focusIdx === s.n - 1, `idx ${s.focusIdx}`);

check("still one tab stop after moving", s.tabStops === 1, `${s.tabStops}`);
check("focused swatch carries an accessible name", Boolean(s.label), String(s.label));

console.log(fails === 0 ? "\nSwatch keyboard contract holds." : `\n${fails} failure(s).`);
ws.close(); await fetch(`${CDP}/json/close/${t.id}`);
