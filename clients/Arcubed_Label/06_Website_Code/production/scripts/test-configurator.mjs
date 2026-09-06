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

    const colours = await evalIn(send, `
      [...document.querySelectorAll('.swatch, .colour-chip, [class*="swatch"] button, .opt-group button')]
        .map(b => (b.getAttribute('aria-label') || b.title || b.textContent || '').trim()).filter(Boolean).slice(0,40)`);

    // Find the colour control group by its label, then its buttons.
    const info = await evalIn(send, `(() => {
      const groups = [...document.querySelectorAll('.opt-group')];
      const g = groups.find(x => /^colour/i.test((x.querySelector('.opt-label')||{}).textContent||''));
      if (!g) return { found:false, groups: groups.map(x=>(x.querySelector('.opt-label')||{}).textContent) };
      const btns = [...g.querySelectorAll('button')];
      return { found:true, labels: btns.map(b => (b.getAttribute('aria-label')||b.textContent||'').trim()) };
    })()`);

    const perColour = [];
    if (info?.found) {
      for (let i = 0; i < info.labels.length; i++) {
        await evalIn(send, `(() => {
          const g = [...document.querySelectorAll('.opt-group')].find(x => /^colour/i.test((x.querySelector('.opt-label')||{}).textContent||''));
          g.querySelectorAll('button')[${i}].click();
        })()`);
        await new Promise((r) => setTimeout(r, 700));
        const shown = await evalIn(send, `(() => {
          const img = document.querySelector('.pg-img');
          const src = img ? (img.currentSrc || img.src) : '';
          const m = decodeURIComponent(src).match(/(DSC\\d+)/);
          const note = document.querySelector('.pg-note');
          const price = (document.querySelector('.price-inline')||{}).textContent || '';
          return { frame: m ? m[1] : null, note: note ? note.textContent.trim().slice(0,80) : null, price: price.trim() };
        })()`);
        perColour.push({ colour: info.labels[i], ...shown });
      }
    }

    // Other controls: do they exist, and does the image respond?
    const others = await evalIn(send, `(() => {
      const out = {};
      for (const g of document.querySelectorAll('.opt-group')) {
        const label = ((g.querySelector('.opt-label')||{}).textContent||'').trim();
        if (/^colour/i.test(label)) continue;
        out[label] = g.querySelectorAll('button, [role="button"]').length;
      }
      return out;
    })()`);

    results.push({ slug, colours: perColour, others, colourCount: info?.labels?.length ?? 0, groups: info?.groups });
  });
}

for (const r of results) {
  console.log(`\n=== /product/${r.slug} ===`);
  if (!r.colours.length) { console.log("  no colour group found; groups:", r.groups); }
  for (const c of r.colours) {
    console.log(`  ${String(c.colour).padEnd(16)} -> frame ${String(c.frame).padEnd(9)} ${c.note ? "NOTE: " + c.note : ""}`);
  }
  console.log("  other controls:", JSON.stringify(r.others));
}
