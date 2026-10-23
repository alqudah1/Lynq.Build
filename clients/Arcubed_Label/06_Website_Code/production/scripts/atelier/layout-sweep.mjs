// Product-page layout sweep (and, with LOCK=1, the locked-photograph proof)
// on any deployment. Read-only.
//
//   PLAYWRIGHT=… BASE=… WIDTHS=375,390,… ENGINE=chromium|webkit OUT=dir [LOCK=1] \
//     node scripts/atelier/layout-sweep.mjs
//
// Layout: no horizontal overflow, no clipped text, no overlapping controls
// (the phone buy bar is fixed and excluded), layout shift 0.
// LOCK: for every enabled colour, no pixel outside the yarn mask changes, the
// bag never moves or resizes, and the stage is never blank.
import { pathToFileURL } from "node:url";
const pw = await import(pathToFileURL(process.env.PLAYWRIGHT).href);
const BASE = process.env.BASE, ENGINE = process.env.ENGINE || "chromium", OUT = process.env.OUT;
const SLUGS = (process.env.SLUGS || "nova,mini-luna,vault,loco").split(",");
const b = await pw[ENGINE].launch();
let fails = 0;
for (const W of (process.env.WIDTHS || "390").split(",").map(Number)) {
  const H = W < 768 ? 844 : W < 1100 ? (W === 1024 ? 768 : 1000) : 900, MOB = W < 768;
  const c = await b.newContext({ viewport: { width: W, height: H }, isMobile: MOB && ENGINE !== "firefox", hasTouch: MOB, deviceScaleFactor: 2, ...(process.env.REDUCED ? { reducedMotion: "reduce" } : {}) });
  const p = await c.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { window.__cls = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); } catch {} });
  for (const slug of SLUGS) {
    await p.goto(`${BASE}/product/${slug}`, { waitUntil: "load" });
    await p.waitForFunction(() => document.querySelector(".at-stage .rc-canvas[data-render-ms]"), null, { timeout: 60000 });
    await p.waitForTimeout(700);
    if (OUT) await p.screenshot({ path: `${OUT}/${ENGINE}-${slug}-${W}.png` });
    const m = await p.evaluate(() => {
      const clipped = [...document.querySelectorAll(".at-sw-name, .at-pill, .at-name, .at-price, .at-meta, .at-h, .at-add, .at-info")].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim().slice(0, 16));
      const els = [...document.querySelectorAll(".at-sw, .at-pill, .at-rail .at-add, .at-info")].filter((e) => !e.closest(".at-buybar")); const ov = [];
      for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) { const a = els[i].getBoundingClientRect(), q = els[j].getBoundingClientRect(); if (a.left < q.right - 0.5 && q.left < a.right - 0.5 && a.top < q.bottom - 0.5 && q.top < a.bottom - 0.5) ov.push(els[i].textContent.trim() + "|" + els[j].textContent.trim()); }
      const word = document.querySelector(".at-word").getBoundingClientRect(), stage = document.querySelector(".at-stage").getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > innerWidth, clipped, ov: ov.slice(0, 3), cls: +window.__cls.toFixed(3), wordInside: word.left >= stage.left - 1 && word.right <= stage.right + 1 };
    });
    const bad = m.overflow || m.clipped.length || m.ov.length || m.cls > 0.01 || !m.wordInside;
    if (bad) fails++;
    console.log(`${bad ? "FAIL" : "PASS"} ${ENGINE} ${W} ${slug} ${JSON.stringify(m)}`);
    if (process.env.LOCK) {
      await p.evaluate(async () => {
        const cv = document.querySelector(".at-stage .rc-canvas"), id = document.querySelector(".at-frame").dataset.frame;
        const img = new Image(); img.src = `/media/recolour/${id}-mask-1600.png`; await img.decode();
        const k = document.createElement("canvas"); k.width = img.width; k.height = img.height; k.getContext("2d").drawImage(img, 0, 0);
        window.__mask = k.getContext("2d").getImageData(0, 0, k.width, k.height).data;
        window.__base = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
        const r = cv.getBoundingClientRect(); window.__rect = [r.left + scrollX, r.top + scrollY, r.width, r.height].map(Math.round).join();
      });
      const sw = p.locator(".at-swatches .at-sw:not([disabled])"); const n = await sw.count(); const rows = [];
      for (let i = 0; i < n; i++) {
        const el = sw.nth(i), name = await el.getAttribute("aria-label");
        await el.evaluate((e) => { e.scrollIntoView({ block: "center" }); scrollBy(0, e.getBoundingClientRect().top - innerHeight * 0.6); });
        await (MOB ? el.tap() : el.click());
        let blank = false;
        for (let t = 0; t < 6; t++) { blank ||= await p.evaluate(() => { const f = document.querySelector(".at-frame"); const cv = f.querySelector(".rc-canvas"); const img = f.querySelector("img"); const ghost = f.querySelector(".at-ghost"); return !(cv && getComputedStyle(cv).visibility !== "hidden") && !(img && img.complete) && !(ghost && Number(getComputedStyle(ghost).opacity) > 0.5); }); await p.waitForTimeout(30); }
        await p.waitForTimeout(500);
        const r = await p.evaluate(() => {
          const f = document.querySelector(".at-frame");
          if (f.dataset.render === "photo") return { render: "photo" };
          const cv = f.querySelector(".rc-canvas"), d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data, m = window.__mask, base = window.__base;
          let outside = 0; for (let q = 0; q < m.length / 4; q++) if (m[q * 4] === 0 && (d[q * 4] !== base[q * 4] || d[q * 4 + 1] !== base[q * 4 + 1] || d[q * 4 + 2] !== base[q * 4 + 2] || d[q * 4 + 3] !== base[q * 4 + 3])) outside++;
          const R = cv.getBoundingClientRect();
          return { render: f.dataset.render, outside, samePlace: [R.left + scrollX, R.top + scrollY, R.width, R.height].map(Math.round).join() === window.__rect };
        });
        const good = !blank && (r.render === "photo" || (r.outside === 0 && r.samePlace));
        if (!good) fails++;
        rows.push(`${name}:${good ? "ok" : "FAIL " + JSON.stringify({ ...r, blank })}`);
        if (OUT && r.render !== "photo") { await p.evaluate(() => scrollTo(0, 0)); }
      }
      console.log(`  lock ${slug}: ${rows.join("  ")}`);
    }
  }
  if (errs.length) { fails++; console.log(`FAIL runtime errors at ${W}: ${errs.slice(0, 2).join(" | ")}`); }
  await c.close();
}
await b.close();
console.log(fails ? `FAILURES: ${fails}` : "all passed");
process.exit(fails ? 1 : 0);
