// WebKit, prefers-reduced-motion: the story becomes a plain document, and
// every part of it is visible AND reachable.
import { webkit, BASE, ok, done, phone } from "./lib.mjs";

const b = await webkit.launch();
const c = await phone(b, 390, 844, { reducedMotion: "reduce" });
const p = await c.newPage();
await p.goto(BASE + "/", { waitUntil: "load" }); await p.waitForTimeout(1500);
const r = await p.evaluate(() => {
  const stage = document.querySelector(".story-stage");
  const phases = [...document.querySelectorAll(".story-stage > .phase")];
  const tops = phases.map((ph) => Math.round(ph.getBoundingClientRect().top + scrollY));
  return {
    pos: getComputedStyle(stage).position,
    phases: phases.length,
    distinct: new Set(tops).size,
    inert: phases.filter((ph) => ph.inert).length,
    custShown: [...document.querySelectorAll(".cust-bag img")].filter((i) => getComputedStyle(i).opacity === "1").length,
    rail: [...document.querySelectorAll(".cust-pick")].length,
    shapes: [...document.querySelectorAll(".shape-link")].length,
  };
});
ok("the story is not sticky", r.pos === "static", r.pos);
ok("every phase is laid out in order", r.phases === 5 && r.distinct === 5, `${r.distinct} distinct offsets`);
ok("no phase is inert", r.inert === 0, `${r.inert}`);
ok("all five colourways are shown", r.custShown === 5, `${r.custShown}`);
ok("colour links and shape links are present", r.rail === 5 && r.shapes === 4, `${r.rail} colours, ${r.shapes} shapes`);
await p.locator(".shape-link").first().scrollIntoViewIfNeeded();
await p.locator(".shape-link").first().tap(); await p.waitForTimeout(1500);
ok("a shape is tappable in the static layout", new URL(p.url()).pathname === "/product/nova", new URL(p.url()).pathname);
await p.goto(BASE + "/faq", { waitUntil: "load" }); await p.waitForTimeout(800);
ok("FAQ answers do not animate", (await p.evaluate(() => getComputedStyle(document.querySelector(".fq .faq-list details")).transitionDuration)) === "0s");
await p.evaluate(() => document.querySelector(".ft").scrollIntoView({ block: "end" }));
await p.locator(".ft-toggle").first().tap(); await p.waitForTimeout(300);
ok("footer still opens", (await p.locator(".ft-toggle").first().getAttribute("aria-expanded")) === "true");
await c.close(); await b.close();
done();
