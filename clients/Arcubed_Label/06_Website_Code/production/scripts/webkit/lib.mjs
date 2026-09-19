// Shared harness for the WebKit suites (real Safari engine, real touch).
//
// WHY THESE LIVE IN THE REPO NOW. Every WebKit suite from earlier passes lived
// in a session scratch directory, and when that directory was cleared they
// were simply gone: the navigation, footer, reduced-motion, reveal and touch
// checks that had been reported as passing could not be re-run. They are
// committed here so the next pass runs the same checks against the same site.
//
// Playwright is NOT a project dependency (the storefront has no use for it and
// the Vercel build should not install it). Point PLAYWRIGHT at any install:
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs \
//     BASE=https://arcubed-preview.vercel.app node scripts/webkit/wk-touch.mjs
import { pathToFileURL } from "node:url";

const spec = process.env.PLAYWRIGHT ? pathToFileURL(process.env.PLAYWRIGHT).href : "playwright";
export const { webkit } = await import(spec);
export const BASE = process.env.BASE || "http://127.0.0.1:4312";

let pass = 0, fail = 0;
export function ok(name, cond, detail = "") {
  if (cond) pass++; else fail++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
}
export function done() {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
export const PHONES = [[375, 812], [390, 844], [430, 932]];
export const phone = (b, w, h, extra = {}) =>
  b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, ...extra });
export const desktop = (b, w = 1440, h = 900, extra = {}) =>
  b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, ...extra });
/** Park the homepage story at a progress value (0..1) and let it settle. */
export async function parkStory(p, at) {
  await p.evaluate((a) => {
    const e = document.querySelector(".story");
    const top = e.getBoundingClientRect().top + scrollY;
    scrollTo(0, Math.round(top + a * (e.offsetHeight - innerHeight)));
  }, at);
  await p.waitForTimeout(3200);
}
