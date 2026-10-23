// Product pages on a mid-range phone: 390x844 DPR3, ~8 Mbps 4G (150 ms RTT),
// CPU slowed 4x, cache disabled. Chrome only (CDP throttling). Read-only.
//   PLAYWRIGHT=… BASE=… node scripts/atelier/perf-mobile.mjs
import { pathToFileURL } from "node:url";
const pw = await import(pathToFileURL(process.env.PLAYWRIGHT).href);
const b = await pw.chromium.launch();
const rows = [];
for (const slug of ["nova", "mini-luna", "vault", "loco"]) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const p = await c.newPage(); const cdp = await c.newCDPSession(p);
  await cdp.send("Network.enable"); await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 1e6, uploadThroughput: 375e3 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  let bytes = 0; p.on("response", (r) => { bytes += Number(r.headers()["content-length"] || 0); });
  await p.addInitScript(() => {
    window.__lcp = 0; window.__cls = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true });
  });
  const t0 = Date.now();
  await p.goto(`${process.env.BASE}/product/${slug}`, { waitUntil: "commit" });
  await p.waitForFunction(() => { const f = document.querySelector(".at-frame"); const i = f?.querySelector("img"); return f?.querySelector(".rc-canvas[data-render-ms]") || (i && i.complete && i.naturalWidth); }, null, { timeout: 60000 });
  const bagVisible = Date.now() - t0;
  await p.waitForFunction(() => document.querySelector(".at-frame .rc-canvas[data-render-ms]"), null, { timeout: 60000 });
  const coloursReady = Date.now() - t0;
  await p.waitForTimeout(2500);
  const sw = p.locator(".at-swatches .at-sw:not([disabled])"); const n = await sw.count(); const taps = [];
  for (let i = 1; i < Math.min(n, 4); i++) {
    const before = await p.evaluate(() => document.querySelector(".at-frame .rc-canvas")?.getAttribute("data-colour") + "|" + document.querySelector(".at-frame").dataset.render);
    const t = Date.now(); await sw.nth(i).tap();
    await p.waitForFunction((b0) => { const f = document.querySelector(".at-frame"); const now = f.querySelector(".rc-canvas")?.getAttribute("data-colour") + "|" + f.dataset.render; return now !== b0 && (f.dataset.render === "photo" ? f.querySelector("img")?.complete : !!f.querySelector(".rc-canvas[data-render-ms]")); }, before, { timeout: 20000 });
    taps.push(Date.now() - t);
  }
  const back = Date.now(); await sw.nth(0).tap(); await p.waitForTimeout(50);
  await p.waitForFunction(() => document.querySelector(".at-frame .rc-canvas[data-render-ms]"), null, { timeout: 20000 });
  const cached = Date.now() - back;
  const m = await p.evaluate(() => ({ lcp: Math.round(window.__lcp), cls: +window.__cls.toFixed(3), heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }));
  rows.push({ bag: slug, bagVisibleMs: bagVisible, lcpMs: m.lcp, coloursReadyMs: coloursReady, tapToColourMs: taps.join("/"), backToFirstMs: cached, cls: m.cls, jsHeapMB: m.heap, transferKB: Math.round(bytes / 1024) });
  await c.close();
}
console.table(rows);
await b.close();
