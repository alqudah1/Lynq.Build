// End-to-end test of the Colour Atelier shop and the colour workflow,
// against a PRIVATE LOCAL copy of the database (see scripts/atelier/README.md).
// It creates a test colour, publishes it, buys it with Cash on Delivery,
// checks the order end to end, then takes the colour off sale again.
//
// REFUSES to run unless BASE is a localhost URL and the local test database's
// SQL door (127.0.0.1:54322) answers: it can never touch arcubed.shop data.
//
//   PLAYWRIGHT=/path/to/playwright/index.mjs BASE=http://localhost:4313 \
//   PASSFILE=/path/to/admin-pass YARN=/path/to/test-yarn.jpg node scripts/atelier/e2e-local.mjs
import { pathToFileURL } from "node:url";
import fs from "node:fs";

const BASE = process.env.BASE ?? "";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) { console.error("REFUSED: BASE must be a local server."); process.exit(2); }
const sql = async (q) => {
  const r = await fetch("http://127.0.0.1:54322", { method: "POST", body: q });
  const j = await r.json();
  if (!r.ok) throw new Error(`SQL: ${j.error}`);
  return j;
};
try { await sql("select 1"); } catch { console.error("REFUSED: the local test database (127.0.0.1:54322) is not running."); process.exit(2); }

const pw = await import(pathToFileURL(process.env.PLAYWRIGHT).href);
const ENGINE = process.env.ENGINE || "chromium";
const b = await pw[ENGINE].launch();
const c = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await c.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
p.on("dialog", (d) => d.accept());
let f = 0;
const ok = (n, x, d = "") => { if (!x) f++; console.log(`  ${x ? "PASS" : "FAIL"}  ${n}${d ? "  -> " + d : ""}`); };
const NAME = process.env.NAME || "Navy";
// Next.js streams a page into hidden placeholders and then moves it into
// place: for a moment the DOM holds two copies. Navigate, then wait until no
// streamed segment is still pending before touching anything.
const go = async (page, url) => {
  await page.goto(url);
  await page.waitForFunction(() => !document.querySelector('div[hidden][id^="S:"]'), null, { timeout: 20000 });
};
const money = (s) => Number(String(s).replace(/[^\d.]/g, ""));

// ---------- clean slate for the test colour (local DB only) ----------
await sql(`delete from public.colour_candidates where lower(name) = lower('${NAME}')`);
const prior = await sql(`select id from public.colours where lower(name) = lower('${NAME}')`);
if (prior.length) {
  await sql(`delete from public.order_items where configuration_snapshot->>'colourName' = '${NAME}'`).catch(() => {});
  await sql(`delete from public.product_colours where colour_id = '${prior[0].id}'`);
  await sql(`delete from public.colours where id = '${prior[0].id}'`).catch(() => {});
}

console.log("\n=== A. colour workflow (admin)");
await go(p, BASE + "/admin");
await p.fill("#passphrase", fs.readFileSync(process.env.PASSFILE, "utf8").trim());
await p.locator('form button[type="submit"]').first().click();
await p.waitForURL((u) => u.pathname.startsWith("/admin/orders"));
await go(p, BASE + "/admin/colours");
await p.locator("h1", { hasText: "Colours" }).first().waitFor();
ok("colours admin loads", (await p.locator(".cw-new").count()) === 1);
await p.fill('input[name="name"]', NAME);
await p.selectOption('select[name="material"]', "metallic-raffia");
await p.locator(".cw-new button[type=submit]").click();
await p.waitForURL((u) => /\/admin\/colours\/[0-9a-f-]{36}$/.test(u.pathname));
const candId = new URL(p.url()).pathname.split("/").pop();
ok("colour created as a draft, not for sale", /Draft/i.test(await p.locator(".cw-badges").innerText()) && /Not for sale/i.test(await p.locator(".cw-badges").innerText()));
ok("publish disabled for a draft", await p.locator(".cw-btn-strong").isDisabled());

await p.locator('.cw-upload input[type="file"]').setInputFiles(process.env.YARN);
await p.waitForSelector(".cw-ref-img img");
await p.waitForFunction(() => /#[0-9a-f]{6}/.test(document.querySelector(".cw-measure .cw-mono")?.textContent ?? ""));
const box = await p.locator(".cw-ref-img").boundingBox();
await p.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.15); await p.mouse.down();
await p.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.85, { steps: 6 }); await p.mouse.up();
await p.waitForTimeout(300);
const measured = (await p.locator(".cw-measure .cw-mono").innerText()).slice(0, 7);
ok("yarn measured from the photograph", /^#[0-9a-f]{6}$/.test(measured), measured);
const slider = p.locator(".cw-cal input[type=range]").first();
await slider.focus(); for (let i = 0; i < 4; i++) await p.keyboard.press("ArrowRight");
const calibrated = (await p.locator(".cw-cal-out .cw-mono").innerText()).trim();
ok("calibration changes the colour", calibrated !== measured, `${measured} -> ${calibrated}`);
await p.locator(".cw-step button", { hasText: "Save photograph and colour" }).click();
await p.waitForSelector(".cw-ok");
await p.waitForTimeout(500);
let row = (await sql(`select status, hex_value, measured_hex, length(reference_image) len, product_slugs from public.colour_candidates where id = '${candId}'`))[0];
ok("photograph, measurement and calibration saved", row.hex_value === calibrated && row.measured_hex === measured && row.len > 1000, JSON.stringify({ ...row, len: row.len }));

await p.waitForFunction(() => document.querySelectorAll(".cw-prev .rc-canvas[data-render-ms]").length >= 2, null, { timeout: 30000 });
const prevs = await p.locator(".cw-prev figcaption").allInnerTexts();
ok("previews on Nova and Mini Luna (same yarn)", prevs.some((t) => /^Nova$/.test(t)) && prevs.some((t) => /^Mini Luna$/.test(t)), prevs.join(" | "));
ok("Vault and Loco refused (different yarn)", prevs.filter((t) => /not offered: different yarn/.test(t)).length === 2);
ok("Vault cannot be ticked", await p.locator(".cw-checks label", { hasText: "Vault" }).locator("input").isDisabled());

await p.locator(".cw-checks label", { hasText: /^Nova/ }).locator("input").check();
await p.locator(".cw-step button", { hasText: "Save bags" }).click();
await p.waitForFunction(() => /Bags saved/.test(document.querySelector(".cw-ok")?.textContent ?? ""));
await p.locator("button", { hasText: "Submit for review" }).click();
await p.waitForFunction(() => /In review/i.test(document.querySelector(".cw-badges")?.textContent ?? ""));
ok("submitted for review", true);
await p.fill('.cw-review input[placeholder="Rand"]', "QA test");
await p.locator(".cw-review button", { hasText: "Approve" }).click();
await p.waitForFunction(() => /Approved/i.test(document.querySelector(".cw-badges")?.textContent ?? ""));
ok("approved, still not for sale", /Not for sale/i.test(await p.locator(".cw-badges").innerText()));
ok("publish still disabled without supplier confirmation", await p.locator(".cw-btn-strong").isDisabled());
const notOnShop = await sql(`select count(*)::int n from public.colours where lower(name) = lower('${NAME}')`);
ok("approval alone creates nothing orderable", notOnShop[0].n === 0);
await p.locator(".cw-check input").check();
await p.fill('input[placeholder^="Supplier"]', "QA test supplier note");
await p.locator(".cw-step", { hasText: "Supplier" }).locator("button", { hasText: "Save" }).click();
await p.waitForFunction(() => /Supplier confirmed/i.test(document.querySelector(".cw-badges")?.textContent ?? ""));
await p.locator(".cw-btn-strong").click();
await p.waitForFunction(() => /Published/i.test(document.querySelector(".cw-badges")?.textContent ?? ""), null, { timeout: 15000 });
row = (await sql(`select c.published_colour_id, k.name, k.hex_value, pc.active from public.colour_candidates c join public.colours k on k.id = c.published_colour_id join public.product_colours pc on pc.colour_id = k.id join public.products pr on pr.id = pc.product_id and pr.slug = 'nova' where c.id = '${candId}'`))[0];
ok("published into the catalogue: colours + product_colours (Nova only)", row && row.hex_value === calibrated && row.active === true, JSON.stringify(row));
const onLuna = await sql(`select count(*)::int n from public.product_colours pc join public.products pr on pr.id = pc.product_id and pr.slug = 'mini-luna' where pc.colour_id = '${row.published_colour_id}'`);
ok("not added to bags that were not chosen", onLuna[0].n === 0);

console.log("\n=== B. shop: choose, configure, buy");
await go(p, BASE + "/product/nova");
await p.waitForFunction(() => document.querySelector(".at-stage .rc-canvas")?.getAttribute("data-render-ms"));
const sw = p.locator(".at-sw", { hasText: new RegExp(`^${NAME}$`) });
ok("new colour offered on Nova", (await sw.count()) === 1);
await sw.click();
await p.waitForFunction((n) => document.querySelector(".at-frame")?.dataset.render === "measured" && document.querySelector(".at-stage .rc-canvas")?.getAttribute("data-colour")?.startsWith("measured-" + n), NAME, { timeout: 20000 });
ok("drawn on the locked photograph from its measured yarn colour", (await p.locator(".at-frame").getAttribute("data-frame")) === "DSC05776");
ok("price unchanged by colour", money(await p.locator(".at-price").innerText()) === 55);
await p.locator('.at-group[aria-label="Size"] .at-pill', { hasText: "Large" }).click();
await p.locator(".at-group .at-pill", { hasText: "Gold Tone" }).click();
const shown = money(await p.locator(".at-price").innerText());
ok("Large + Gold Tone Chain = JOD 70", shown === 70, String(shown));
ok("corner price follows", money(await p.locator(".at-meta-tl").innerText()) === shown);
await p.locator(".at-add").first().click();
await p.waitForSelector(".cart-drawer.open");
await p.waitForFunction(() => document.querySelector(".cart-drawer canvas.snap-thumb")?.width > 0, null, { timeout: 20000 });
ok("cart thumbnail is the recoloured Nova (not another colour's photo)", true);
await go(p, BASE + "/product/mini-luna");
ok("not offered on Mini Luna", (await p.locator(".at-sw", { hasText: new RegExp(`^${NAME}$`) }).count()) === 0);

// edit from the cart: change size, price follows
await go(p, BASE + "/cart");
await p.locator(".cart-line-actions a", { hasText: "Edit" }).first().click();
await p.waitForURL((u) => u.searchParams.has("edit"));
await p.waitForFunction(() => document.querySelector(".at-stage .rc-canvas")?.getAttribute("data-render-ms"));
ok("edit reopens the exact configuration", (await p.locator(".at-sw.is-on").innerText()).trim().toUpperCase() === NAME.toUpperCase() && /Large/.test(await p.locator('.at-group[aria-label="Size"] .at-pill.is-on').innerText()));
await p.locator('.at-group[aria-label="Size"] .at-pill', { hasText: "Medium" }).click();
ok("Medium + Gold Tone Chain = JOD 65", money(await p.locator(".at-price").innerText()) === 65);
await p.locator(".at-add", { hasText: /Save changes/i }).click();
await p.waitForURL((u) => u.pathname === "/cart");
ok("cart line updated to JOD 65", money(await p.locator(".cart-line-price").first().innerText()) === 65);
const cartBefore = await p.evaluate(() => localStorage.getItem("arcubed_cart_v1"));

await go(p, BASE + "/checkout");
await p.fill("#f-name", "LOCAL E2E test (local database only)");
await p.fill("#f-phone", "0790000000");
await p.fill("#f-email", "e2e@example.test");
await p.selectOption("#f-zone", { label: "Inside Amman" });
await p.fill("#f-city", "Amman");
await p.fill("#f-address", "Local test address");
const summaryCanvas = await p.locator("#co-summary-body canvas.snap-thumb").count();
ok("checkout summary shows the recoloured thumbnail", summaryCanvas === 1);
await p.locator(".co-submit").click();
await p.waitForURL((u) => u.pathname.startsWith("/order/"), { timeout: 30000 });
const token = new URL(p.url()).pathname.split("/").pop();
ok("Cash on Delivery order placed (local database)", Boolean(token));
const ocText = await p.locator(".oc-lines").innerText();
ok("confirmation shows the configuration", new RegExp(NAME).test(ocText) && /Medium/.test(ocText) && /Gold Tone/.test(ocText), ocText.replace(/\s+/g, " ").slice(0, 160));
await p.waitForFunction(() => document.querySelector(".oc-lines canvas.snap-thumb")?.width > 0, null, { timeout: 20000 });
ok("confirmation thumbnail is the recoloured Nova", true);

const ord = (await sql(`select o.order_number, o.subtotal, o.shipping_amount, o.total, o.payment_method, o.payment_status, i.unit_price, i.quantity, i.configuration_snapshot->>'colourName' colour, i.configuration_snapshot->>'colourHex' hex, i.configuration_snapshot->>'sizeLabel' size, i.configuration_snapshot->>'chainLabel' chain from public.orders o join public.order_items i on i.order_id = o.id where o.confirmation_token = '${token}'`))[0];
ok("order item recorded at the displayed price", Number(ord.unit_price) === 65 && ord.quantity === 1, JSON.stringify(ord));
ok("recorded configuration matches", ord.colour === NAME && ord.size === "Medium" && /Gold Tone/.test(ord.chain) && ord.hex === calibrated);
ok("totals consistent; Cash on Delivery, unpaid", Number(ord.total) === Number(ord.subtotal) + Number(ord.shipping_amount) && Number(ord.subtotal) === 65 && ord.payment_method === "cash_on_delivery" && ord.payment_status === "unpaid");

await go(p, BASE + "/admin/orders");
const adm = p.locator(".adm-order").filter({ has: p.locator(".adm-num", { hasText: ord.order_number }) }).first();
await adm.waitFor();
const admText = await adm.innerText();
ok("admin order shows the configuration and price", new RegExp(NAME).test(admText) && /Medium/.test(admText) && /65/.test(admText), admText.replace(/\s+/g, " ").slice(0, 200));

console.log("\n=== C. take it off sale");
await go(p, BASE + "/admin/colours");
await p.locator(".cw-bag", { hasText: "Nova" }).locator("li", { hasText: new RegExp(`^${NAME}`) }).locator(".cw-switch").click();
await p.waitForFunction((n) => [...document.querySelectorAll(".cw-bag li")].some((li) => li.textContent.startsWith(n) && li.classList.contains("is-off")), NAME, { timeout: 15000 });
ok("switched off on Nova", true);
await go(p, BASE + "/product/nova");
ok("no longer offered on the shop", (await p.locator(".at-sw", { hasText: new RegExp(`^${NAME}$`) }).count()) === 0);
await p.evaluate((v) => localStorage.setItem("arcubed_cart_v1", v), cartBefore);
await go(p, BASE + "/checkout");
await p.fill("#f-name", "LOCAL E2E test (local database only)"); await p.fill("#f-phone", "0790000000"); await p.fill("#f-email", "e2e@example.test");
await p.selectOption("#f-zone", { label: "Inside Amman" }); await p.fill("#f-city", "Amman"); await p.fill("#f-address", "Local test address");
const ordersBefore = (await sql("select count(*)::int n from public.orders"))[0].n;
await p.locator(".co-submit").click();
await p.waitForTimeout(3000);
const ordersAfter = (await sql("select count(*)::int n from public.orders"))[0].n;
ok("checkout refuses a colour taken off sale (no order created)", ordersAfter === ordersBefore && !p.url().includes("/order/"), (await p.locator(".co-err, [role=alert]").allInnerTexts()).join(" | ").slice(0, 160));

console.log("\n=== D. access");
const anon = await b.newContext(); const q = await anon.newPage();
await go(q, BASE + "/admin/colours");
ok("signed-out visitor cannot open the colour admin", new URL(q.url()).pathname === "/admin");
await anon.close();
ok("no runtime errors", errs.length === 0, errs.slice(0, 2).join(" | "));
await b.close();
console.log(f ? `\nFAILURES: ${f}` : "\nall passed");
process.exit(f ? 1 : 0);
