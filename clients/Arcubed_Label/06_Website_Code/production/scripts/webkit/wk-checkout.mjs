// THE WHOLE PURCHASE, DRIVEN WITH REAL TOUCH.
//
// Configure a Nova, watch the panel carry the configuration, change the
// quantity, remove the line, add it back, go to checkout, check the totals
// against the shipping table, fail validation on purpose, then place a real
// order and read the confirmation.
//
// WHAT THIS CATCHES THAT THE OTHER SUITES DO NOT. test-checkout-e2e.mjs drives
// Chrome and asserts the server side: prices, shipping, the order record. This
// one is about the SURFACE on a phone — the controls in the cart panel, the
// collapsed order summary, the inline field errors, and whether the handle a
// customer chose is still on the screen at every step. The handle was in the
// snapshot and in the price and shown nowhere from the summary onwards.
//
// IT WRITES A REAL ORDER. Supabase is shared with production, so each run
// leaves one row named "LYNQ QA checkout (delete)". Delete what a run creates:
//   delete from order_items where order_id in
//     (select id from orders where customer_name = 'LYNQ QA checkout (delete)');
//   delete from orders where customer_name = 'LYNQ QA checkout (delete)';
// Pass SKIP_ORDER=1 to run everything up to, but not including, submission.
//
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs \
//     BASE=http://127.0.0.1:4312 node scripts/webkit/wk-checkout.mjs
//   VIEWPORT=1440x900 ... to run it at a desktop width instead.

import { webkit, BASE, ok, done } from "./lib.mjs";

const [W, H] = (process.env.VIEWPORT || "390x844").split("x").map(Number);
const MOB = W < 940;
const SKIP_ORDER = process.env.SKIP_ORDER === "1";

const b = await webkit.launch();
const c = await b.newContext({
  viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: MOB, hasTouch: MOB,
});
const p = await c.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(e.message.slice(0, 90)));

const txt = async (sel) => (await p.locator(sel).first().innerText()).replace(/\s+/g, " ").trim();
const tap = async (loc) => {
  await loc.scrollIntoViewIfNeeded();
  await p.waitForTimeout(150);
  if (MOB) await loc.tap(); else await loc.click();
};
const grp = (label) =>
  p.locator(".opt-group").filter({ has: p.locator(".opt-label", { hasText: label }) }).first();

console.log(`\n=== checkout ${W}x${H} ${MOB ? "touch" : "pointer"}`);

/* 1 — a Nova that is not the default: Black, Large, no handle, gold chain. */
await p.goto(BASE + "/product/nova", { waitUntil: "load" });
await p.waitForTimeout(1600);
await tap(p.locator('.csw[aria-label="Black"]'));
await p.waitForTimeout(700);
await tap(p.locator(".pill", { hasText: "Large" }));
await tap(grp("Handle").locator("button", { hasText: "Without Handle" }));
await tap(grp("Chain").locator("button", { hasText: "Gold Tone Chain" }));
await p.waitForTimeout(500);
// 55 base + 5 for Large + 5 for the chain. The button carries the live price.
ok("options are priced on the button", /65/.test(await txt(".add-to-bag")), await txt(".add-to-bag"));
await tap(p.locator(".add-to-bag").first());
await p.waitForTimeout(1400);

/* 2 — the panel is a cart, not a receipt. */
ok("panel opens on add", (await p.locator(".cart-drawer.open").count()) === 1);
const cfg = await txt(".drawer-line-opt");
ok("panel shows colour, size, handle and chain",
   /Black/.test(cfg) && /Large/.test(cfg) && /Without Handle/.test(cfg) && /Gold Tone Chain/.test(cfg), cfg);
ok("panel has a quantity stepper", (await p.locator(".drawer-line-controls .qty-stepper").count()) === 1);
ok("panel has a remove control", (await p.locator(".drawer-remove").count()) === 1);
ok("panel has a Checkout CTA", (await p.locator('.drawer-actions a[href="/checkout"]').count()) === 1);
ok("panel keeps View Cart and Keep Shopping",
   (await p.locator('.drawer-actions a[href="/cart"]').count()) === 1 &&
   (await p.locator(".drawer-keep").count()) === 1);

/* 3 — quantity changes the line, the subtotal and the badge together. */
await tap(p.locator('.drawer-line-controls .qty-stepper button[aria-label^="Increase"]'));
await p.waitForTimeout(700);
ok("quantity reads 2", (await txt(".drawer-line-controls .qty-stepper span")) === "2");
ok("line total doubles", /130/.test(await txt(".drawer-line-price")), await txt(".drawer-line-price"));
ok("subtotal follows", /130/.test(await txt(".drawer-subtotal")), await txt(".drawer-subtotal"));
ok("header badge counts 2", (await txt(".cart-icon .badge")) === "2");

/* 4 — remove, then add the same thing again. */
await tap(p.locator(".drawer-remove"));
await p.waitForTimeout(800);
ok("remove empties the panel", /Nothing here yet/i.test(await txt(".cart-drawer")));
// The badge stays in the DOM and hides at zero, so this asks whether it SHOWS.
ok("badge clears", !(await p.locator(".cart-icon .badge").isVisible()));
await tap(p.locator(".icon-btn[aria-label='Close cart']"));
await p.waitForTimeout(600);
await tap(p.locator(".add-to-bag").first());
await p.waitForTimeout(1300);
ok("re-adding keeps the configuration", /Black/.test(await txt(".drawer-line-opt")) &&
   /Gold Tone Chain/.test(await txt(".drawer-line-opt")));

/* 5 — the panel's Checkout CTA goes to checkout. */
await tap(p.locator('.drawer-actions a[href="/checkout"]'));
await p.waitForURL((u) => u.pathname === "/checkout", { timeout: 9000 }).catch(() => {});
await p.waitForTimeout(1800);
ok("Checkout CTA reaches /checkout", new URL(p.url()).pathname === "/checkout");

/* 6 — the summary collapses on a phone and never on a desktop. */
const summaryShown = () => p.locator("#co-summary-body").isVisible();
if (MOB) {
  ok("summary starts collapsed on a phone", !(await summaryShown()));
  ok("collapsed row carries count and total", /1 item/.test(await txt(".co-summary-toggle")), await txt(".co-summary-toggle"));
  await tap(p.locator(".co-summary-toggle"));
  await p.waitForTimeout(600);
  ok("tapping expands it", await summaryShown());
} else {
  ok("summary is always open on a desktop", await summaryShown());
  ok("no disclosure control on a desktop", !(await p.locator(".co-summary-toggle").isVisible()));
}
ok("summary repeats the whole configuration, handle included",
   /Without Handle/.test(await txt(".co-line-config")), await txt(".co-line-config"));

/* 7 — every total comes from the shipping table, not from this file. */
const totals = async () => (await txt(".co-totals")).replace(/\s+/g, " ");
await p.selectOption("#f-zone", { label: "Inside Amman" });
await p.waitForTimeout(600);
ok("Amman: shipping 3, total 68", /Shipping JOD 3/.test(await totals()) && /Total JOD 68/.test(await totals()), await totals());
await p.selectOption("#f-zone", { label: "Outside Amman" });
await p.waitForTimeout(600);
ok("outside Amman: shipping 5, total 70", /Shipping JOD 5/.test(await totals()) && /Total JOD 70/.test(await totals()), await totals());
await p.selectOption("#f-zone", { label: "Worldwide" });
await p.waitForTimeout(600);
ok("worldwide is quoted, never guessed", /Quoted by destination/.test(await totals()), await totals());
await p.selectOption("#f-zone", { label: "Inside Amman" });
await p.waitForTimeout(600);

/* 8 — the page claims nothing the business has not confirmed. */
const body = (await p.innerText("body")).replace(/\s+/g, " ");
ok("payment section states no payment is taken", /No payment is taken on this site/i.test(body));
ok("no invented payment method", !/cash on delivery|\bcliq\b|card number|visa|mastercard/i.test(body));
ok("no discount field", (await p.locator('input[name*="discount" i], input[placeholder*="discount" i], input[placeholder*="promo" i]').count()) === 0);
ok("no pickup option", !/pick ?up/i.test(body));

/* 9 — validation happens before anything is sent. */
await tap(p.locator(".co-submit"));
await p.waitForTimeout(1200);
ok("empty submit is stopped with field errors", (await p.locator(".co-err").count()) >= 3,
   `${await p.locator(".co-err").count()} errors`);
ok("focus lands on the first bad field", (await p.evaluate(() => document.activeElement?.id)) === "f-name");
ok("still on checkout", new URL(p.url()).pathname === "/checkout");
await p.fill("#f-email", "not-an-email");
await tap(p.locator(".co-submit"));
await p.waitForTimeout(800);
ok("a bad email is caught inline", /doesn't look right/.test(await txt("#e-email")));

/* 10 — a real order, and the confirmation that follows it. */
if (SKIP_ORDER) {
  console.log("  SKIP  order submission (SKIP_ORDER=1)");
} else {
  await p.fill("#f-name", "LYNQ QA checkout (delete)");
  await p.fill("#f-phone", "0790000000");
  await p.fill("#f-email", "qa@lynq.build");
  await p.fill("#f-city", "Amman");
  await p.fill("#f-address", "QA test address, ignore");
  await tap(p.locator(".co-submit"));
  await p.waitForURL((u) => u.pathname.startsWith("/order/"), { timeout: 25000 }).catch(() => {});
  await p.waitForTimeout(2000);
  const onOrder = new URL(p.url()).pathname.startsWith("/order/");
  ok("order placed, confirmation shown", onOrder, p.url().replace(BASE, ""));
  if (onOrder) {
    const conf = (await p.innerText("body")).replace(/\s+/g, " ");
    ok("confirmation carries an order number", /AR-\d{8}-[A-Z0-9]+/.test(conf), conf.match(/AR-\d{8}-[A-Z0-9]+/)?.[0]);
    ok("confirmation keeps the whole configuration",
       /Black/.test(conf) && /Large/.test(conf) && /Without Handle/.test(conf) && /Gold Tone Chain/.test(conf));
    ok("confirmation states 5 to 7 days", /5 to 7 days/.test(conf));
    ok("confirmation totals 65 + 3 = 68", /JOD 65/.test(conf) && /JOD 3/.test(conf) && /JOD 68/.test(conf));
    ok("confirmation does not claim payment", !/\bpaid\b|payment received/i.test(conf));
  }
}

ok("no runtime errors anywhere in the flow", errs.length === 0, errs.slice(0, 2).join(" | "));
await b.close();
done();
