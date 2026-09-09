// Measures the vertical rhythm of the MATERIAL -> FORM transition: where the
// copy ends, where the ribbon boundary sits, and where the forms begin, so the
// "too loose" gap is a number rather than an impression.
const BASE = process.argv[2]?.startsWith("http") ? process.argv[2] : (process.env.BASE || "http://127.0.0.1:4311");
const CDP = "http://127.0.0.1:9222";
const P = Number(process.env.P || 0.50);
const SIZES = (process.env.SIZES || "1440x900,768x1024,375x812").split(",").map(s => s.split("x").map(Number));

const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); const pending = new Map(); let id = 0;
await new Promise(r => { ws.onopen = r; });
ws.onmessage = m => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x.result); pending.delete(x.id); } };
const send = (m, p = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const ev = async e => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });

for (const [w, h] of SIZES) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 900 });
  await send("Page.navigate", { url: BASE + "/" });
  await new Promise(r => setTimeout(r, 3000));
  await ev(`(()=>{const s=document.querySelector('.story');const t=s.offsetHeight-innerHeight;scrollTo(0,Math.round(s.offsetTop+t*${P}));return 1})()`);
  await new Promise(r => setTimeout(r, 2500));
  const o = await ev(`(()=>{
    const r=s=>{const e=document.querySelector(s);return e?e.getBoundingClientRect():null;};
    const band=r('.shape-thread'), note=r('.shape-note'), head=r('.shape-head');
    const sils=[...document.querySelectorAll('.sil')].map(e=>e.getBoundingClientRect());
    const topSil = sils.length? Math.min(...sils.map(x=>x.top)) : null;
    const rowTop = sils.length? Math.min(...sils.map(x=>x.top)) : null;
    const items=[...document.querySelectorAll('.shape-item')].map(e=>e.getBoundingClientRect());
    const rowBottom = items.length? Math.max(...items.map(x=>x.bottom)) : null;
    return JSON.stringify({
      vh: innerHeight, headBottom: head&&Math.round(head.bottom),
      gapHeadToBand: (head&&band)? Math.round(band.top-head.bottom):null,
      bandTop: band&&Math.round(band.top), bandBottom: band&&Math.round(band.bottom),
      noteBottom: note&&Math.round(note.bottom),
      formsTop: rowTop&&Math.round(rowTop), formsBottom: rowBottom&&Math.round(rowBottom),
      gapNoteToForms: (note&&rowTop!=null)? Math.round(rowTop-note.bottom):null,
      gapBandToForms: (band&&rowTop!=null)? Math.round(rowTop-band.bottom):null,
      tallestSil: sils.length? Math.round(Math.max(...sils.map(x=>x.height))):null,
      overflowLeft: items.length? Math.round(Math.min(...items.map(x=>x.left))):null,
      overflowRight: items.length? Math.round(Math.max(...items.map(x=>x.right))):null
    });})()`);
  const d = JSON.parse(o);
  console.log(`${String(w).padStart(4)}x${h}  vh=${d.vh}  band ${d.bandTop}..${d.bandBottom}  noteEnd ${d.noteBottom}  forms ${d.formsTop}..${d.formsBottom}`);
  console.log(`         GAP head->band ${d.gapHeadToBand}px | note->forms ${d.gapNoteToForms}px | band->forms ${d.gapBandToForms}px | tallest form ${d.tallestSil}px | row x ${d.overflowLeft}..${d.overflowRight} (vp ${w})`);
}
ws.close(); await fetch(`${CDP}/json/close/${t.id}`);
