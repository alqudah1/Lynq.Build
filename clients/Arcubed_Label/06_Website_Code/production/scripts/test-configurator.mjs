// Drives the real product page in a browser and records, per control, whether
// the visual actually responds. Answers brief §28 with evidence rather than
// assertion: for every colourway of every product it clicks the swatch and
// checks which archive frame the gallery then displays.
const BASE = process.argv[2] || "http://127.0.0.1:4311";
const CDP = "http://127.0.0.1:9222";

async function session(fn) {
  const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map(); const events = []; let id = 0;
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => { const x = JSON.parse(m.data);
    if (x.id && pending.has(x.id)) { pending.get(x.id)(x.result); pending.delete(x.id); } else if (x.method) events.push(x); };
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  try { return await fn(send, events); } finally { ws.close(); await fetch(`${CDP}/json/close/${target.id}`); }
}

const evalIn = async (send, expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;

const PRODUCTS = ["nova", "vault", "mini-luna", "loco"];
const results = [];

for (const slug of PRODUCTS) {
  await session(async (send) => {
    await send("Runtime.enable"); await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: `${BASE}/product/${slug}` });
    await new Promise((r) => setTimeout(r, 2600));

    // The Colour Atelier (2026-10-15): one swatch row; every colour redraws
    // the stage. Records what the stage shows for each colour.
    const info = await evalIn(send, `(() => {
      const btns = [...document.querySelectorAll('.at-swatches .at-sw')];
      if (!btns.length) return { found:false, groups: [...document.querySelectorAll('.at-group')].map(g=>g.getAttribute('aria-label')) };
      return { found:true, labels: btns.map(b => (b.getAttribute('aria-label')||'').trim()) };
    })()`);

    const perColour = [];
    if (info?.found) {
      for (let i = 0; i < info.labels.length; i++) {
        await evalIn(send, `document.querySelectorAll('.at-swatches .at-sw')[${i}].click()`);
        let shown = null;
        for (let t = 0; t < 40; t++) {
          await new Promise((r) => setTimeout(r, 150));
          shown = await evalIn(send, `(() => {
            const f = document.querySelector('.at-frame');
            const cv = f && f.querySelector('.rc-canvas[data-render-ms]');
            const img = f && f.querySelector('img');
            const drawn = f && (f.dataset.render === 'photo' ? !!(img && img.complete && img.naturalWidth) : !!cv);
            return { frame: drawn ? f.dataset.frame : null, render: f ? f.dataset.render : null,
                     note: f && f.dataset.render === 'photo' ? 'own photograph (cannot be recoloured)' : null,
                     price: (document.querySelector('.at-price')||{}).textContent || '' };
          })()`);
          if (shown?.frame) break;
        }
        perColour.push({ colour: info.labels[i], ...shown });
      }
    }

    // Other controls: the option groups and how many choices each offers.
    const others = await evalIn(send, `(() => {
      const out = {};
      for (const g of document.querySelectorAll('.at-group')) out[g.getAttribute('aria-label')] = g.querySelectorAll('button').length;
      return out;
    })()`);

    results.push({ slug, colours: perColour, others, colourCount: info?.labels?.length ?? 0, groups: info?.groups });
  });
}

for (const r of results) {
  console.log(`\n=== /product/${r.slug} ===`);
  if (!r.colours.length) { console.log("  no colour group found; groups:", r.groups); }
  for (const c of r.colours) {
    console.log(`  ${String(c.colour).padEnd(16)} -> ${String(c.render).padEnd(8)} frame ${String(c.frame).padEnd(9)} ${c.price.trim()} ${c.note ? "NOTE: " + c.note : ""}`);
  }
  console.log("  other controls:", JSON.stringify(r.others));
}

const rows = results.flatMap((r) => r.colours);
const blank = rows.filter((c) => !c.frame);
console.log(`\n${rows.length} colour rows, ${blank.length} with nothing drawn`);
process.exit(blank.length || rows.length === 0 ? 1 : 0);
