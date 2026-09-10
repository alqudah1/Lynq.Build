// Is the header actually usable during the story on a phone?
// For each phase: is it on screen, are the cart and menu hit-testable at their
// own centres, what ground is behind them, and does the header box overlap any
// text or control belonging to the phase underneath.
const BASE = process.argv[2]?.startsWith("http") ? process.argv[2] : (process.env.BASE || "http://127.0.0.1:4311");
const CDP = "http://127.0.0.1:9222";
const SIZES = (process.env.SIZES || "375x812,390x844,430x932").split(",").map(s => s.split("x").map(Number));
// Sampled where each phase actually owns the top of the screen.
const POINTS = [["hero", 0.01], ["enter", 0.15], ["material", 0.38], ["shape", 0.55],
                ["custom", 0.70], ["closing", 0.92], ["collection", "past"]];
// LEAF elements that actually paint. Wrapper boxes like .hero-type and
// .cust-copy span the whole stage, so testing those reports an overlap at
// every phase whether or not a single glyph is near the header.
const CONTENT = ".hero-l1, .hero-l2, .hero-l3, .hero-note p, .hero-cta, .mat-note, .mat-fact, .mat-img img,"
  + " .shape-head, .shape-note, .cust-head, .cust-rail li, .cust-foot, .cust-bag img, .final-line, .story-label";

const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); const pending = new Map(); let id = 0;
await new Promise(r => { ws.onopen = r; });
ws.onmessage = m => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x.result); pending.delete(x.id); } };
const send = (m, p = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const ev = async e => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
await send("Page.enable"); await send("Runtime.enable");

let bad = 0;
for (const [w, h] of SIZES) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Page.navigate", { url: BASE + "/" });
  await new Promise(r => setTimeout(r, 3000));
  console.log(`\n=== ${w}x${h} ===`);
  for (const [name, p] of POINTS) {
    await ev(p === "past"
      ? `(()=>{const s=document.querySelector('.story');scrollTo(0,s.offsetTop+s.offsetHeight+200);return 1})()`
      : `(()=>{const s=document.querySelector('.story');const t=s.offsetHeight-innerHeight;scrollTo(0,Math.round(s.offsetTop+t*${p}));return 1})()`);
    await new Promise(r => setTimeout(r, 650));
    const o = JSON.parse(await ev(`(()=>{
      const hit=(el)=>{const r=el.getBoundingClientRect();const x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);
        const top=document.elementFromPoint(x,y); return {ok: !!top && (el===top||el.contains(top)), got: top?(top.className?.toString()||top.tagName).slice(0,20):'null'};};
      const hd=document.querySelector('.site-header'), hr=hd.getBoundingClientRect();
      const cart=document.querySelector('.cart-icon'), menu=document.querySelector('.menu-toggle');
      const logoImg=[...document.querySelectorAll('.logo img')].find(i=>getComputedStyle(i).display!=='none');
      // what is painted behind the header's own strip
      const bgEl=document.elementsFromPoint(Math.round(innerWidth/2), Math.round(hr.bottom+6))
        .find(e=>{const b=getComputedStyle(e).backgroundColor; return b&&b!=='rgba(0, 0, 0, 0)';});
      const overlaps=[...document.querySelectorAll(${JSON.stringify(CONTENT)})].filter(e=>{
        const r=e.getBoundingClientRect(); const cs=getComputedStyle(e);
        if(r.width<4||r.height<4||cs.visibility==='hidden'||+cs.opacity<0.06) return false;
        return r.top < hr.bottom && r.bottom > hr.top;
      }).map(e=>e.className.toString().split(' ')[0]);
      return JSON.stringify({onScreen: hr.bottom>0 && hr.top< innerHeight, top:Math.round(hr.top), bottom:Math.round(hr.bottom),
        ground: document.documentElement.dataset.ground||'-', state: document.documentElement.dataset.story||'-',
        cart: hit(cart), menu: hit(menu), logo: logoImg?(decodeURIComponent(logoImg.currentSrc).match(/wordmark-(\\w+)/)||[])[1]||'?':'none',
        behind: bgEl?getComputedStyle(bgEl).backgroundColor:'?', overlaps:[...new Set(overlaps)]});})()`));
    const problems = [];
    if (!o.onScreen) problems.push("HEADER OFF SCREEN");
    if (!o.cart.ok) problems.push(`cart not hittable (${o.cart.got})`);
    if (!o.menu.ok) problems.push(`menu not hittable (${o.menu.got})`);
    if (o.overlaps.length) problems.push(`overlaps ${o.overlaps.join(",")}`);
    if (problems.length) bad++;
    console.log(`  ${name.padEnd(11)} h=${String(o.top)}..${o.bottom} ground=${o.ground.padEnd(5)} behind=${o.behind.padEnd(18)} logo=${o.logo.replace('arcubed-wordmark-','').replace('.png','').padEnd(5)} ${problems.length ? "FAIL " + problems.join(" | ") : "ok"}`);
  }
}
console.log(bad === 0 ? "\nHeader reachable and clear of content at every sampled phase." : `\n${bad} problem sample(s).`);
ws.close(); await fetch(`${CDP}/json/close/${t.id}`);
