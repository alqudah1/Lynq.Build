// WebKit footer: collapsed, tappable, accessible groups on a phone; open
// columns on a desktop.
import { webkit, BASE, ok, done, phone, desktop } from "./lib.mjs";

const b = await webkit.launch();
console.log("\n=== WebKit 390 footer ===");
{
  const c = await phone(b, 390, 844);
  const p = await c.newPage();
  await p.goto(BASE + "/faq", { waitUntil: "load" }); await p.waitForTimeout(900);
  await p.evaluate(() => document.querySelector(".ft").scrollIntoView({ block: "end" }));
  await p.waitForTimeout(500);
  const toggles = p.locator(".ft-toggle");
  const n = await toggles.count();
  ok("three footer groups", n === 3, `${n}`);
  for (let i = 0; i < n; i++) {
    const t = toggles.nth(i);
    const box = await t.boundingBox();
    const ctl = await t.getAttribute("aria-controls");
    ok(`group ${i + 1} is a 40px+ button`, (await t.evaluate((e) => e.tagName)) === "BUTTON" && box.height >= 40, `${Math.round(box.height)}px`);
    ok(`group ${i + 1} controls its panel`, !!ctl && (await p.locator(`[id="${ctl}"]`).count()) === 1);
    ok(`group ${i + 1} starts collapsed`, (await t.getAttribute("aria-expanded")) === "false");
    await t.tap(); await p.waitForTimeout(350);
    ok(`group ${i + 1} opens on a tap`, (await t.getAttribute("aria-expanded")) === "true");
    await t.tap(); await p.waitForTimeout(350);
    ok(`group ${i + 1} closes on a second tap`, (await t.getAttribute("aria-expanded")) === "false");
  }
  await toggles.nth(0).focus(); await p.keyboard.press("Enter"); await p.waitForTimeout(300);
  ok("keyboard Enter opens a group", (await toggles.nth(0).getAttribute("aria-expanded")) === "true");
  await c.close();
}
console.log("\n=== WebKit 1440 footer ===");
{
  const c = await desktop(b);
  const p = await c.newPage();
  await p.goto(BASE + "/faq", { waitUntil: "load" }); await p.waitForTimeout(900);
  const r = await p.evaluate(() => ({
    toggles: [...document.querySelectorAll(".ft-toggle")].filter((t) => getComputedStyle(t).display !== "none").length,
    heads: [...document.querySelectorAll(".ft-h")].filter((t) => getComputedStyle(t).display !== "none").map((t) => t.textContent.trim()),
  }));
  ok("desktop shows headings, not toggles", r.toggles === 0 && r.heads.length === 3, r.heads.join(" / "));
  await c.close();
}
await b.close();
done();
