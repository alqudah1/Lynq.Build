// WebKit, real taps, the things the client touched: shapes, the colour rail,
// colour changes in the model blocks, the Nova options, Add to Cart and its
// decision panel, the menu, the Loco gallery and the FAQ.
import { webkit, BASE, ok, done, phone, PHONES, parkStory } from "./lib.mjs";

const stem = (u) => decodeURIComponent(u || "").split("url=").pop().split("&")[0].split("/").pop()
  .replace(/-(\d+|full)\.webp$/, "").replace(/-(cut|tile)$/, "");

// The URL flips before a soft navigation commits, and a goto() fired in that
// window is "interrupted" by it. Probed separately: one tap = one navigation.
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(600); };
// ...and if one still lands late, the goto is simply repeated.
const go = async (p, url) => {
  try { await p.goto(url, { waitUntil: "load" }); }
  catch (e) { if (!/interrupted by another navigation/.test(e.message)) throw e; await settle(p); await p.goto(url, { waitUntil: "load" }); }
};

const b = await webkit.launch();
for (const [w, h] of PHONES) {
  console.log(`\n=== WebKit ${w}x${h} touch ===`);
  const c = await phone(b, w, h);
  const p = await c.newPage();
  const path = () => new URL(p.url()).pathname;

  // ---- PHONE 11: every shape opens its product ---------------------------
  for (const slug of ["nova", "mini-luna", "vault", "loco"]) {
    await go(p, BASE + "/"); await p.waitForTimeout(1200);
    await parkStory(p, 0.40);
    const link = p.locator(`.shape-${slug} .shape-link`);
    const box = await link.boundingBox();
    const y0 = await p.evaluate("scrollY");
    await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height * 0.35);
    await p.waitForURL((u) => u.pathname.startsWith("/product/"), { timeout: 8000 }).catch(() => {}); await settle(p);
    ok(`tapping the ${slug} shape opens its page`, path() === `/product/${slug}`, `${path()} (tapped the form, not the name; page was at ${Math.round(y0)})`);
  }

  // ---- PHONE 4: a colour in the rail opens that colourway ----------------
  await go(p, BASE + "/"); await p.waitForTimeout(1200);
  await parkStory(p, 0.58);
  const gold = p.locator(".cust-pick", { hasText: "Gold" }).first();
  const gb = await gold.boundingBox();
  await p.touchscreen.tap(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await p.waitForURL((u) => u.pathname === "/product/mini-luna", { timeout: 8000 }).catch(() => {}); await settle(p);
  await p.waitForTimeout(900);
  ok("tapping Gold in the rail opens Mini Luna in Gold", path() === "/product/mini-luna" &&
     (await p.locator('.at-sw[aria-pressed="true"]').getAttribute("aria-label")) === "Gold",
     `${path()} / ${await p.locator('.at-sw[aria-pressed="true"]').getAttribute("aria-label").catch(() => "?")}`);

  // ---- PHONE 3: changing colours never moves the page --------------------
  await go(p, BASE + "/shop"); await p.waitForTimeout(1200);
  await p.locator(".mc-nova .mc-ways").scrollIntoViewIfNeeded(); await p.waitForTimeout(400);
  const y0 = await p.evaluate("scrollY");
  const ways = p.locator(".mc-nova .mc-way");
  for (let k = 0; k < 12; k++) { await ways.nth(k % 6).tap(); await p.waitForTimeout(60); }
  await p.waitForTimeout(600);
  ok("twelve rapid colour taps leave the page still", Math.abs((await p.evaluate("scrollY")) - y0) <= 1,
     `${Math.round(y0)} -> ${Math.round(await p.evaluate("scrollY"))}`);

  // ---- PHONE 5, PC 4, PHONE 6: Nova options and the post-add decision ----
  await go(p, BASE + "/product/nova"); await p.waitForTimeout(1500);
  // The Colour Atelier: Regular is the base price; every other size names its extra.
  const pills = await p.locator('.at-group[aria-label="Size"] .at-pill').allTextContents();
  ok("every size says what it costs", pills.length === 3 && pills.slice(1).every((t) => /\+JOD/.test(t)) && !/\+/.test(pills[0]), pills.join(" | "));
  // Strap and chain are ONE choice in the Atelier ("Strap or chain"): exactly one is ever selected.
  const carry = p.locator('.at-group[aria-label="Strap or chain"]');
  const pressed = async () => (await carry.locator('[aria-pressed="true"]').allTextContents()).join("|");
  await carry.locator("button", { hasText: "Crochet Strap" }).tap();
  await carry.locator("button", { hasText: "Silver Tone Chain" }).tap();
  ok("chain after strap replaces the strap", /^Silver Tone Chain/.test(await pressed()), await pressed());
  await carry.locator("button", { hasText: "Crochet Strap" }).tap();
  ok("strap after chain replaces the chain", /^Crochet Strap/.test(await pressed()), await pressed());
  await carry.locator("button", { hasText: "None" }).tap();
  ok("a strap can be removed again", (await pressed()) === "None");
  await carry.locator("button", { hasText: "Gold Tone Chain" }).tap();
  const add = p.locator(".at-add").first();
  await add.scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
  const ay = await p.evaluate("scrollY"), url0 = p.url();
  ok("the button says Add to Cart", /Add to Cart/i.test(await add.textContent()));
  await add.tap(); await p.waitForTimeout(800);
  ok("adding does not navigate", p.url() === url0);
  ok("adding does not move the page", Math.abs((await p.evaluate("scrollY")) - ay) <= 1);
  ok("the panel confirms the add", (await p.locator("#cart-drawer-title").textContent()) === "Added to your cart");
  ok("the added line names the chain", /Gold Tone Chain/.test(await p.locator(".drawer-line.is-added .drawer-line-opt").textContent()));
  ok("View Cart and Keep Shopping are offered", (await p.locator(".drawer-actions a", { hasText: "View Cart" }).isVisible()) &&
     (await p.locator(".drawer-keep").isVisible()));
  await p.locator(".drawer-keep").tap(); await p.waitForTimeout(600);
  ok("Keep Shopping closes the panel and keeps the choice", !(await p.locator(".cart-drawer.open").count()) &&
     /Gold Tone/.test(await pressed("Chain")));
  const bb = await add.boundingBox();
  await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await p.waitForTimeout(800);
  ok("a double tap adds once", (await p.locator(".cart-icon .badge").textContent()) === "2",
     `badge ${await p.locator(".cart-icon .badge").textContent()}`);
  ok("the same bag twice is one line", (await p.locator(".drawer-line").count()) === 1);
  ok("a double tap leaves the panel open", (await p.locator(".cart-drawer.open").count()) === 1);
  await p.locator(".drawer-actions a", { hasText: "View Cart" }).tap();
  await p.waitForURL((u) => u.pathname === "/cart", { timeout: 8000 }).catch(() => {}); await settle(p);
  ok("View Cart opens the cart", path() === "/cart");
  await p.evaluate(() => localStorage.clear());

  // ---- PHONE 9: the menu reaches every shape -----------------------------
  await go(p, BASE + "/faq"); await p.waitForTimeout(900);
  await p.evaluate("scrollTo(0, 500)");
  for (const [label, slug] of [["Nova", "nova"], ["Mini Luna", "mini-luna"], ["Vault", "vault"], ["Loco", "loco"]]) {
    await p.locator(".menu-toggle").tap(); await p.waitForTimeout(450);
    await p.locator(".mobile-menu-models a", { hasText: label }).tap();
    await p.waitForURL((u) => u.pathname === `/product/${slug}`, { timeout: 8000 }).catch(() => {}); await settle(p);
    await p.waitForTimeout(500);
    ok(`menu opens ${label}`, path() === `/product/${slug}` &&
       (await p.evaluate(() => document.body.style.overflow)) === "" &&
       !(await p.locator(".mobile-menu.open").count()), path());
  }

  // ---- Loco: the real photographs of the colour, and rapid colour taps ---
  await go(p, BASE + "/product/loco"); await p.waitForTimeout(1500);
  const photos = p.locator(".at-photos img");
  await p.locator(".at-photos").scrollIntoViewIfNeeded(); await p.waitForTimeout(600);
  const n = await photos.count();
  ok("Loco Brown shows its three photographs", n === 3, `${n}`);
  const seen = [];
  for (let k = 0; k < n; k++) seen.push(stem(await photos.nth(k).getAttribute("src")));
  ok("no duplicate frames", new Set(seen).size === n && !seen.includes("DSC05764") && !seen.includes("DSC05766"), seen.join(", "));
  const sws = p.locator(".at-swatches .at-sw:not([disabled])");
  await sws.first().scrollIntoViewIfNeeded();
  const y1 = await p.evaluate("scrollY");
  for (let k = 0; k < 9; k++) await sws.nth(k % (await sws.count())).tap();
  await p.waitForTimeout(900);
  const last = (await sws.nth(8 % (await sws.count())).getAttribute("aria-label")) ?? "";
  ok("rapid colour taps settle on the last one tapped", (await p.locator(".at-sw.is-on").getAttribute("aria-label")) === last, last);
  ok("rapid colour taps leave the page still", Math.abs((await p.evaluate("scrollY")) - y1) <= 1);

  // ---- FAQ ----------------------------------------------------------------
  await go(p, BASE + "/faq"); await p.waitForTimeout(900);
  const sums = p.locator(".fq .faq-list summary");
  let opened = 0;
  for (let k = 0; k < (await sums.count()); k++) {
    await sums.nth(k).scrollIntoViewIfNeeded(); await sums.nth(k).tap(); await p.waitForTimeout(250);
    const s = await p.evaluate((i) => { const d = document.querySelectorAll(".fq .faq-list details")[i];
      return d.open && getComputedStyle(d).backgroundColor === "rgb(255, 224, 253)"; }, k);
    if (s) opened++;
    await sums.nth(k).tap(); await p.waitForTimeout(200);
  }
  ok("every FAQ answer opens on a tap, on the pink field", opened === (await sums.count()), `${opened}/${await sums.count()}`);
  await c.close();
}
await b.close();
done();
