// Full-site audit: every route, every breakpoint, real browser.
//
// Reports what a previous summary cannot: the UPSCALE RATIO of every rendered
// image (displayed CSS pixels vs the decoded bitmap), console errors,
// horizontal overflow, broken images, and hydration warnings. Writes JSON so
// the media audit can be built from measurements rather than assumptions.
//
// Usage: node scripts/audit-site.mjs [baseUrl]
const BASE = process.argv[2] || "http://127.0.0.1:4311";
const CDP = "http://127.0.0.1:9222";
import { writeFileSync, mkdirSync } from "node:fs";
mkdirSync(".audit", { recursive: true });

const ROUTES = ["/", "/shop", "/product/nova", "/product/vault", "/product/mini-luna", "/product/loco",
  "/cart", "/checkout", "/ready-for-delivery", "/about", "/faq", "/contact"];
const VIEWPORTS = [{ n: "375", w: 375, h: 812 }, { n: "768", w: 768, h: 1024 }, { n: "1440", w: 1440, h: 900 }];

async function session(fn) {
  const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  const pending = new Map(); const events = []; let id = 0;
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); }
    else if (d.method) events.push(d);
  };
  const send = (method, params = {}) =>
    new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  try { return await fn(send, events); }
  finally { ws.close(); await fetch(`${CDP}/json/close/${t.id}`); }
}

const PROBE = `(() => {
  const imgs = [...document.images].map(i => {
    const r = i.getBoundingClientRect();
    const dispW = Math.round(r.width), dispH = Math.round(r.height);
    // devicePixelRatio 1 in these runs, so CSS px == device px.
    const up = i.naturalWidth ? +(dispW / i.naturalWidth).toFixed(2) : null;
    return { src: (i.currentSrc || i.src).replace(location.origin, ""), natW: i.naturalWidth, natH: i.naturalHeight,
             dispW, dispH, upscale: up, broken: i.complete && i.naturalWidth === 0, alt: i.alt || "" };
  }).filter(i => i.dispW > 0);
  const de = document.documentElement;
  const over = [];
  document.querySelectorAll('body *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > de.clientWidth + 2 || r.left < -2)) {
      over.push({ tag: el.tagName.toLowerCase(), cls: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : String(el.className || '')).slice(0,60),
                  left: Math.round(r.left), right: Math.round(r.right) });
    }
  });
  return {
    title: document.title,
    scrollW: de.scrollWidth, clientW: de.clientWidth,
    hOverflow: de.scrollWidth > de.clientWidth + 1,
    imgs,
    overflowers: over.slice(0, 6),
    // Any customer-visible text that reads like implementation commentary.
    dashes: (document.body.innerText.match(/[\\u2014\\u2013]/g) || []).length,
  };
})()`;

const out = [];
for (const vp of VIEWPORTS) {
  for (const route of ROUTES) {
    const res = await session(async (send, events) => {
      await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable");
      // Cache OFF. A stale browser derivative once made this audit report an
      // image as correctly sized while the page actually rendered an older,
      // smaller one — the audit disagreed with the screen.
      await send("Network.enable"); await send("Network.setCacheDisabled", { cacheDisabled: true });
      await send("Emulation.setDeviceMetricsOverride", { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.w < 900 });
      await send("Page.navigate", { url: BASE + route });
      const t0 = Date.now();
      while (Date.now() - t0 < 15000 && !events.some((e) => e.method === "Page.loadEventFired")) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 700));
      // Walk the page so lazy images decode and scroll-driven states run.
      await send("Runtime.evaluate", { expression: `(async()=>{const H=document.documentElement.scrollHeight;for(let y=0;y<H;y+=window.innerHeight*0.5){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,140));}window.scrollTo(0,0);})()`, awaitPromise: true });
      await new Promise((r) => setTimeout(r, 900));
      const r = await send("Runtime.evaluate", { returnByValue: true, expression: PROBE });
      const errs = events
        .filter((e) => e.method === "Runtime.exceptionThrown" || (e.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(e.params.type)))
        .map((e) => (e.params?.exceptionDetails?.text || (e.params?.args || []).map((a) => String(a.value ?? "")).join(" ")).slice(0, 180))
        .filter(Boolean);
      return { ...r.result.value, errors: [...new Set(errs)].slice(0, 4) };
    });
    out.push({ vp: vp.n, route, ...res });
    const bad = res.imgs.filter((i) => i.broken).length;
    const ups = res.imgs.filter((i) => i.upscale > 1.15);
    console.log(
      `${vp.n.padEnd(5)} ${route.padEnd(22)} imgs ${String(res.imgs.length).padStart(2)}  broken ${bad}  upscaled ${String(ups.length).padStart(2)}` +
      `  overflow ${res.hOverflow ? "YES" : "no "}  dashes ${String(res.dashes).padStart(2)}  err ${res.errors.length}`
    );
    if (ups.length) for (const u of ups.slice(0, 3)) console.log(`        UPSCALE x${u.upscale}  ${u.dispW}px from ${u.natW}px  ${u.src.slice(0, 70)}`);
    if (res.hOverflow) console.log(`        OVERFLOW scrollW ${res.scrollW} > ${res.clientW}: ${res.overflowers.map(o=>o.tag+"."+o.cls).slice(0,3).join(", ")}`);
    if (res.errors.length) console.log(`        ERR ${res.errors[0]}`);
  }
}
writeFileSync(".audit/site-audit.json", JSON.stringify(out, null, 1));
console.log("\nwrote .audit/site-audit.json");
