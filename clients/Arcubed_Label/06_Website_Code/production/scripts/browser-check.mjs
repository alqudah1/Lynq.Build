// Real browser verification over the Chrome DevTools Protocol.
//
// No Playwright/Puppeteer dependency — Chrome is driven directly with fetch
// (target management) and Node's global WebSocket (CDP). This measures things
// a fetch-based check physically cannot: computed layout, horizontal overflow,
// tap-target sizes, and console errors from real client-side execution.
//
// Usage: node scripts/browser-check.mjs [baseUrl]
const BASE = process.argv[2] || "http://127.0.0.1:4311";
const CDP = "http://127.0.0.1:9222";
const OUT = ".screens";
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "375", width: 375, height: 812, mobile: true },
  { name: "768", width: 768, height: 1024, mobile: true },
  { name: "1440", width: 1440, height: 900, mobile: false },
];
const ROUTES = ["/", "/shop", "/product/nova", "/product/vault", "/product/mini-luna", "/product/loco", "/ready-for-delivery", "/cart", "/faq", "/about", "/contact"];

async function session(fn) {
  const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const events = [];
  let id = 0;
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
    else if (msg.method) events.push(msg);
  };
  const send = (method, params = {}) =>
    new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
  try { return await fn(send, events); }
  finally { ws.close(); await fetch(`${CDP}/json/close/${target.id}`); }
}

const results = [];
for (const vp of VIEWPORTS) {
  for (const route of ROUTES) {
    await session(async (send, events) => {
      await send("Runtime.enable");
      await send("Log.enable");
      await send("Page.enable");
      await send("Emulation.setDeviceMetricsOverride", {
        width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile,
      });
      await send("Page.navigate", { url: BASE + route });
      // Wait for load, then a short settle for client hydration.
      const start = Date.now();
      while (Date.now() - start < 9000 && !events.some((e) => e.method === "Page.loadEventFired")) {
        await new Promise((r) => setTimeout(r, 100));
      }
      await new Promise((r) => setTimeout(r, 600));

      // Scroll the whole page then return to the top: scroll-reveal sections
      // are opacity 0 until their IntersectionObserver fires, so without this
      // every screenshot below the fold captures blank space and the overflow
      // measurement misses hidden-but-present elements.
      await send("Runtime.evaluate", {
        awaitPromise: true,
        expression: `(async () => {
          const step = window.innerHeight * 0.8;
          for (let y = 0; y < document.body.scrollHeight; y += step) {
            window.scrollTo(0, y);
            await new Promise(r => setTimeout(r, 90));
          }
          window.scrollTo(0, 0);
          await new Promise(r => setTimeout(r, 400));
        })()`,
      });

      const { result } = await send("Runtime.evaluate", {
        returnByValue: true,
        expression: `(() => {
          const de = document.documentElement;
          const vw = window.innerWidth;
          const over = [];
          for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.right > vw + 1.5 || r.left < -1.5) {
              over.push((el.tagName.toLowerCase()) + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0,2).join('.') : '') + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']');
            }
          }
          const small = [];
          for (const el of document.querySelectorAll('a,button')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.height < 32 && el.offsetParent !== null) small.push((el.textContent||'').trim().slice(0,22) + ' h=' + Math.round(r.height));
          }
          return {
            scrollWidth: de.scrollWidth, innerWidth: vw,
            horizontalOverflow: de.scrollWidth > vw + 1,
            overflowingCount: over.length, overflowing: over.slice(0, 5),
            smallTapTargets: small.slice(0, 5), smallTapCount: small.length,
            imgs: document.images.length,
            brokenImgs: [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.currentSrc || i.src).slice(0,3),
            canvases: document.querySelectorAll('canvas').length,
            title: document.title,
          };
        })()`,
      });
      const errs = events
        .filter((e) => e.method === "Runtime.exceptionThrown" || (e.method === "Runtime.consoleAPICalled" && e.params.type === "error"))
        .map((e) => e.params?.exceptionDetails?.text || (e.params?.args || []).map((a) => a.value).join(" "))
        .filter(Boolean);
      results.push({ vp: vp.name, route, ...result.value, errors: errs.slice(0, 3), errorCount: errs.length });

      if (["/", "/shop", "/product/nova", "/ready-for-delivery", "/about", "/contact"].includes(route)) {
        const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
        if (shot.data) writeFileSync(`${OUT}/${route.replace(/\W+/g, "_") || "home"}-${vp.name}.png`, Buffer.from(shot.data, "base64"));
      }
    });
  }
}

let bad = 0;
console.log("VP    ROUTE                 OVERFLOW  small-taps  imgs  broken  canvas  errs  title");
for (const r of results) {
  const flag = r.horizontalOverflow || r.errorCount > 0 || r.brokenImgs.length > 0 || r.canvases > 0;
  if (flag) bad++;
  console.log(
    r.vp.padEnd(6), r.route.padEnd(21),
    (r.horizontalOverflow ? `YES(${r.overflowingCount})` : "no").padEnd(10),
    String(r.smallTapCount).padEnd(12), String(r.imgs).padEnd(6),
    String(r.brokenImgs.length).padEnd(8), String(r.canvases).padEnd(8),
    String(r.errorCount).padEnd(6), (r.title || "").slice(0, 30)
  );
  if (r.horizontalOverflow) console.log("        overflow:", r.overflowing.join(" | "));
  if (r.errorCount) console.log("        errors:", r.errors.join(" | "));
  if (r.brokenImgs.length) console.log("        broken images:", r.brokenImgs.join(" | "));
  if (r.smallTapCount) console.log("        small tap targets:", r.smallTapTargets.join(" | "));
}
console.log(`\n${results.length} page-loads checked, ${bad} with findings. Screenshots in ${OUT}/`);
