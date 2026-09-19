// WebKit navigation: every route loads, fits, keeps its header, and the
// browser's own back button works.
import { webkit, BASE, ok, done, phone, desktop } from "./lib.mjs";

const ROUTES = ["/", "/shop", "/about", "/faq", "/contact", "/cart", "/checkout", "/ready-for-delivery",
  "/product/nova", "/product/mini-luna", "/product/vault", "/product/loco"];
const VIEWS = [[375, 812, true], [390, 844, true], [430, 932, true], [768, 1024, true], [1440, 900, false]];

const b = await webkit.launch();
for (const [w, h, mob] of VIEWS) {
  console.log(`\n=== WebKit ${w}x${h} ===`);
  const c = mob ? await phone(b, w, h) : await desktop(b, w, h);
  const p = await c.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  let bad = [], overflow = [];
  for (const r of ROUTES) {
    const res = await p.goto(BASE + r, { waitUntil: "load" });
    await p.waitForTimeout(700);
    // Let prefetches finish before the next goto(). A hard navigation that
    // aborts one in flight makes WebKit report "Fetch API cannot load
    // ...?_rsc=... due to access control checks" — the harness's doing, not
    // the page's: 120 loads with this wait, 0 errors and 0 cancelled requests.
    await p.waitForLoadState("networkidle").catch(() => {});
    if (!res || !res.ok()) bad.push(`${r} ${res?.status()}`);
    const o = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (o > 1) overflow.push(`${r} +${o}px`);
    if (r === "/") ok("cold load starts at the top", (await p.evaluate("scrollY")) === 0);
  }
  ok("every route loads", bad.length === 0, bad.join(", ") || `${ROUTES.length} routes`);
  ok("no horizontal overflow on any route", overflow.length === 0, overflow.join(", ") || "none");
  const hdr = await p.evaluate(() => ({
    logo: !!document.querySelector(".site-header .logo")?.getBoundingClientRect().width,
    cart: !!document.querySelector(".cart-icon")?.getBoundingClientRect().width,
    menu: getComputedStyle(document.querySelector(".menu-toggle")).display !== "none",
  }));
  ok("header shows logo and cart", hdr.logo && hdr.cart);
  ok(mob && w < 760 ? "hamburger present on a phone" : "hamburger absent on desktop", mob && w < 760 ? hdr.menu : !hdr.menu);
  // Browser back from a product page returns to the Shop.
  await p.goto(BASE + "/shop", { waitUntil: "load" }); await p.waitForLoadState("networkidle").catch(() => {});
  await p.goto(BASE + "/product/nova", { waitUntil: "load" }); await p.waitForLoadState("networkidle").catch(() => {});
  await p.goBack({ waitUntil: "load" }); await p.waitForTimeout(600);
  ok("browser back returns to the Shop", new URL(p.url()).pathname === "/shop", new URL(p.url()).pathname);
  ok("no runtime errors", errors.length === 0, errors.slice(0, 2).join(" | ") || "none");
  await c.close();
}
await b.close();
done();
