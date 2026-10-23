// Read-only customer walk-through of the Colour Atelier on any deployment.
// NEVER submits an order: checkout is filled in and stopped before "Place order".
// Safe against the live site.
//
//   PLAYWRIGHT=… BASE=https://arcubed.shop VP=390x844 ENGINE=chromium|webkit OUT=dir \
//     node scripts/atelier/customer-journey.mjs
//
// Expected prices are the confirmed catalogue (docs/release-colour-atelier.md).
import { pathToFileURL } from "node:url";
const pw = await import(pathToFileURL(process.env.PLAYWRIGHT).href);
const BASE = process.env.BASE;
const [W, H] = (process.env.VP || "390x844").split("x").map(Number), MOB = W < 768, ENGINE = process.env.ENGINE || "chromium";
const b = await pw[ENGINE].launch();
const c = await b.newContext({ viewport: { width: W, height: H }, isMobile: MOB, hasTouch: MOB, deviceScaleFactor: 2 });
const p = await c.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
let f = 0; const ok = (n, x, d = "") => { if (!x) f++; console.log(`  ${x ? "PASS" : "FAIL"}  ${n}${d ? "  -> " + d : ""}`); };
const money = (s) => Number(String(s).replace(/[^\d.]/g, ""));
const click = async (l) => { await l.evaluate((e) => { e.scrollIntoView({ block: "center" }); scrollBy(0, e.getBoundingClientRect().top - innerHeight * 0.6); }); await (MOB ? l.tap() : l.click()); };
const drawn = () => p.waitForFunction(() => { const fr = document.querySelector(".at-frame"); return fr?.dataset.render === "photo" ? fr.querySelector("img")?.complete : !!fr?.querySelector(".rc-canvas[data-render-ms]"); }, null, { timeout: 40000 });
console.log(`\n=== customer journey ${BASE} ${ENGINE} ${W}x${H}`);
const EXP = { nova: { base: 55, size: ["Medium", 60] }, "mini-luna": { base: 50, size: ["Small", 50] }, vault: { base: 50, size: ["Large", 55] }, loco: { base: 65 } };
for (const [slug, e] of Object.entries(EXP)) {
  await p.goto(`${BASE}/product/${slug}`); await drawn();
  ok(`${slug}: base price JOD ${e.base}`, money(await p.locator(".at-price").innerText()) === e.base);
  const sw = p.locator(".at-swatches .at-sw"); const n = await sw.count(); let good = 0;
  const frame0 = await p.locator(".at-frame").getAttribute("data-frame");
  for (let i = 0; i < n; i++) {
    await click(sw.nth(i)); await p.waitForTimeout(250); await drawn();
    const st = await p.evaluate(() => ({ on: document.querySelector(".at-sw.is-on")?.getAttribute("aria-label"), render: document.querySelector(".at-frame").dataset.render, frame: document.querySelector(".at-frame").dataset.frame }));
    if (st.on === (await sw.nth(i).getAttribute("aria-label")) && (st.render === "photo" || st.frame === frame0) && money(await p.locator(".at-price").innerText()) === e.base) good++;
  }
  ok(`${slug}: all ${n} colours draw on the same photograph, price unchanged`, good === n, `${good}/${n}`);
  if (e.size) { await click(p.locator('.at-group[aria-label="Size"] .at-pill', { hasText: e.size[0] })); ok(`${slug}: ${e.size[0]} = JOD ${e.size[1]}`, money(await p.locator(".at-price").innerText()) === e.size[1]); }
  const carry = p.locator('.at-group[aria-label="Strap or chain"]');
  const before = money(await p.locator(".at-price").innerText());
  await click(carry.locator("button", { hasText: "Crochet Strap" }));
  ok(`${slug}: Crochet Strap +5`, money(await p.locator(".at-price").innerText()) === before + 5);
  await click(carry.locator("button", { hasText: "Gold Tone Chain" }));
  const pressed = (await carry.locator('[aria-pressed="true"]').allInnerTexts()).join("|");
  ok(`${slug}: chain replaces strap, still +5`, /^Gold Tone Chain/.test(pressed) && money(await p.locator(".at-price").innerText()) === before + 5, pressed);
  if (slug === "nova") { await click(p.locator('.at-group[aria-label="Handle"] .at-pill', { hasText: "Without Handle" })); ok("nova: handle choice is free", money(await p.locator(".at-price").innerText()) === before + 5); }
  ok(`${slug}: corner price matches`, money(await p.locator(".at-meta-tl").innerText()) === money(await p.locator(".at-price").innerText()));
  if (slug === "nova" || slug === "loco") {
    const want = money(await p.locator(".at-price").innerText());
    await click(p.locator(".at-add").first()); await p.waitForSelector(".cart-drawer.open", { timeout: 15000 });
    ok(`${slug}: added to cart at JOD ${want}`, (await p.locator(".cart-drawer").innerText()).includes(String(want)));
    await click(p.locator(".icon-btn[aria-label='Close cart']")); await p.waitForTimeout(400);
  }
  if (process.env.OUT) await p.screenshot({ path: `${process.env.OUT}/${ENGINE}-${W}-${slug}.png` });
}
await p.goto(`${BASE}/cart`); await p.waitForSelector(".cart-line");
ok("cart has both bags", (await p.locator(".cart-line").count()) === 2);
const cartText = (await p.locator("main").innerText()).replace(/\s+/g, " ");
ok("cart shows the configurations", /Gold Tone Chain/.test(cartText) && /Medium/.test(cartText) && /Without Handle/.test(cartText), cartText.slice(0, 160));
await click(p.locator(".cart-line-actions a", { hasText: "Edit" }).first()); await p.waitForURL((u) => u.searchParams.has("edit")); await drawn();
ok("edit reopens the configuration", /Medium/.test(await p.locator('.at-group[aria-label="Size"] .at-pill.is-on').innerText()));
await click(p.locator('.at-group[aria-label="Size"] .at-pill', { hasText: "Large" }));
await click(p.locator(".at-add", { hasText: /Save changes/i })); await p.waitForURL((u) => u.pathname === "/cart");
await p.waitForSelector(".cart-line-price");
const prices = (await p.locator(".cart-line-price").allInnerTexts()).map(money);
ok("edited line repriced (Nova Large + chain = 70)", prices.includes(70), prices.join(", "));
await p.goto(`${BASE}/checkout`); await p.waitForSelector("#f-name");
await p.fill("#f-name", "Walk-through (not submitted)"); await p.fill("#f-phone", "0790000000"); await p.fill("#f-email", "qa@example.test");
await p.selectOption("#f-zone", { label: "Inside Amman" }); await p.fill("#f-city", "Amman"); await p.fill("#f-address", "Not submitted");
if (await p.locator(".co-summary-toggle").isVisible()) await click(p.locator(".co-summary-toggle")); // phones: summary is collapsed
await p.waitForTimeout(400);
const co = (await p.locator("main").innerText()).replace(/\s+/g, " ");
ok("checkout lists both bags with Cash on Delivery", /Nova/.test(co) && /Loco/.test(co) && /Cash on Delivery/i.test(co));
ok("no card fields, no CliQ", (await p.locator('input[autocomplete^="cc-"]').count()) === 0 && !/CliQ/i.test(co));
ok("checkout thumbnails load", await p.evaluate(() => [...document.querySelectorAll("#co-summary-body img, #co-summary-body canvas")].length >= 2));
ok("place-order button ready (NOT pressed)", await p.locator(".co-submit").isEnabled());
if (process.env.OUT) await p.screenshot({ path: `${process.env.OUT}/${ENGINE}-${W}-checkout.png`, fullPage: true });
ok("no horizontal overflow", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
ok("no runtime errors", errs.length === 0, errs.slice(0, 2).join(" | "));
await b.close(); console.log(f ? `FAILURES: ${f}` : "all passed"); process.exit(f ? 1 : 0);
