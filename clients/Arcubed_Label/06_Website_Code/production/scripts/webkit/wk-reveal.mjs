// WebKit Shop reveal: a phone opens on six colourways with an honest way to
// the rest; a desktop shows all sixteen.
import { webkit, BASE, ok, done, phone, desktop } from "./lib.mjs";

const b = await webkit.launch();
const visible = (p) => p.evaluate(() =>
  [...document.querySelectorAll(".cw-reveal .shopx-cell")].filter((c) => getComputedStyle(c).display !== "none").length);
for (const [w, h] of [[375, 812], [390, 844], [430, 932]]) {
  console.log(`\n=== WebKit ${w} Shop ===`);
  const c = await phone(b, w, h);
  const p = await c.newPage();
  await p.goto(BASE + "/shop", { waitUntil: "load" }); await p.waitForTimeout(1200);
  ok("opens on six", (await visible(p)) === 6, `${await visible(p)}`);
  const more = p.locator(".cw-more");
  ok("says how many there are", /16/.test(await more.textContent()), await more.textContent());
  await more.scrollIntoViewIfNeeded(); await more.tap(); await p.waitForTimeout(500);
  ok("tapping shows all sixteen", (await visible(p)) === 16, `${await visible(p)}`);
  ok("the button goes away", !(await more.isVisible()));
  await c.close();
}
console.log("\n=== WebKit 1440 Shop ===");
{
  const c = await desktop(b);
  const p = await c.newPage();
  await p.goto(BASE + "/shop", { waitUntil: "load" }); await p.waitForTimeout(1200);
  ok("all sixteen at once", (await visible(p)) === 16, `${await visible(p)}`);
  ok("no button on desktop", !(await p.locator(".cw-more").isVisible()));
  await c.close();
}
await b.close();
done();
