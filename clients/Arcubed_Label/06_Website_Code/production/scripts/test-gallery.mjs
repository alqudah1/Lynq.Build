// PRODUCT GALLERY INTERACTION — the test that would have caught the
// duplicate Loco frames.
//
// WHY THIS EXISTS
//
// Loco Brown shipped with four gallery images, three of which were the same
// photograph: DSC05764, 05765 and 05766 are three exposures of one setup,
// same camera position, same light, same angle. Every existing check passed
// them. audit-site.mjs counts images and looks for breakage; the detail audit
// measures resolution. Neither has any idea whether two frames show the same
// thing, so a gallery a customer described as "I swipe through them and
// barely anything changes" was reported as clean by the whole suite.
//
// WHAT IT CHECKS, per product, per viewport, driving REAL touch taps:
//
//   1. every thumbnail resolves to a DIFFERENT source frame
//   2. no two frames are near-duplicate PIXELS (mean absolute difference of
//      a downsampled greyscale of the actual bytes — this is the check that
//      catches three exposures of one setup, which no filename comparison
//      can)
//   3. tapping thumbnail N puts frame N in the main stage — the thumbnails
//      and the main image are the same list in the same order
//   4. the main image is not under-resolved at that viewport's real DPR
//   5. the main image is not cropped so hard the bag stops being readable
//
// Needs Chrome on the CDP port, like every other audit here:
//   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
//     --remote-debugging-port=9222 --headless=new
//
// Run:  node scripts/test-gallery.mjs
//       BASE=https://preview node scripts/test-gallery.mjs
//
// Exits non-zero on any failure, so it can gate a deploy.

import sharp from "sharp";
import { realDims } from "./lib-imagesize.mjs";

const CDP = process.env.CDP || "http://127.0.0.1:9222";
const BASE = process.env.BASE || "http://127.0.0.1:4311";
const PRODUCTS = (process.env.PRODUCTS || "nova,mini-luna,vault,loco").split(",");
const VIEWS = [
  { w: 375, h: 812, dpr: 3 },
  { w: 390, h: 844, dpr: 3 },
  { w: 430, h: 932, dpr: 3 },
];

/**
 * How different two frames have to be to count as different views.
 *
 * Measured on the real archive: the three duplicate Loco exposures score 2.6
 * to 3.4 against each other on a 0-255 scale, while the genuinely different
 * views in the same product score 14 and above. 8 sits in the empty middle.
 */
const MIN_DIFF = 8;

/** DSC05765-2600.webp -> DSC05765, loco-brown-detail-full.webp -> loco-brown-detail. */
function stemOf(url) {
  const path = decodeURIComponent(url).replace(/^.*?url=/, "").split("&")[0];
  const file = path.split("/").pop() ?? "";
  return file.replace(/-(?:\d+|full)\.webp$/, "").replace(/-(?:cut|tile)$/, "");
}

async function cdp() {
  const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const waits = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waits.has(m.id)) { waits.get(m.id)(m.result); waits.delete(m.id); }
  };
  const send = (method, params = {}) =>
    new Promise((res) => { const i = ++id; waits.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  return { send, close: () => ws.close(), targetId: t.id };
}

/** Mean absolute difference of two images reduced to a 64x64 grey thumbnail. */
const fingerprints = new Map();
async function fingerprint(url) {
  if (fingerprints.has(url)) return fingerprints.get(url);
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const { data } = await sharp(buf).greyscale().resize(64, 64, { fit: "fill" })
    .raw().toBuffer({ resolveWithObject: true });
  fingerprints.set(url, data);
  return data;
}
function meanDiff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

const { send, close, targetId } = await cdp();
await send("Page.enable");
await send("Runtime.enable");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) pass++; else fail++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
};

/** A real finger, not element.click(): the thumbnails are touch targets. */
async function tap(x, y) {
  const point = [{ x, y, radiusX: 12, radiusY: 12, force: 1 }];
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point });
  await new Promise((r) => setTimeout(r, 45));
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await new Promise((r) => setTimeout(r, 320));
}

for (const slug of PRODUCTS) {
  for (const v of VIEWS) {
    console.log(`\n=== /product/${slug} @ ${v.w}css DPR${v.dpr} ===`);
    await send("Emulation.setDeviceMetricsOverride", {
      width: v.w, height: v.h, deviceScaleFactor: v.dpr, mobile: true,
    });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await send("Page.navigate", { url: `${BASE}/product/${slug}` });
    await new Promise((r) => setTimeout(r, 2600));

    const n = (await send("Runtime.evaluate", {
      returnByValue: true,
      expression: `document.querySelectorAll('.pg-thumb').length`,
    })).result.value;

    if (!n) {
      // A single-frame colourway renders no strip at all, which is correct.
      const only = (await send("Runtime.evaluate", {
        returnByValue: true, expression: `document.querySelector('.pg-img')?.currentSrc ?? ""`,
      })).result.value;
      ok("single-frame gallery renders its one image", Boolean(only));
      continue;
    }

    const seenStems = [];
    const seenUrls = [];
    for (let i = 0; i < n; i++) {
      // Scroll and MEASURE AFTERWARDS, as two steps. Selecting a portrait
      // frame makes the main stage 220px taller, so the strip moves under
      // the finger: a rect read in the same turn as the scroll is stale, and
      // the tap lands on whatever slid into that spot.
      await send("Runtime.evaluate", {
        expression: `document.querySelectorAll('.pg-thumb')[${i}].scrollIntoView({block:'center'})`,
      });
      await new Promise((r) => setTimeout(r, 260));
      const box = (await send("Runtime.evaluate", {
        returnByValue: true,
        expression: `(()=>{const r=document.querySelectorAll('.pg-thumb')[${i}].getBoundingClientRect();
          return {x:r.left+r.width/2, y:r.top+r.height/2, w:r.width, h:r.height};})()`,
      })).result.value;
      await tap(box.x, box.y);

      // The stage <img> is keyed on the frame, so selecting a thumbnail
      // REMOUNTS it and currentSrc is briefly "". Wait for the new element
      // to have actually resolved a candidate before reading anything off it.
      for (let t = 0; t < 40; t++) {
        const ready = (await send("Runtime.evaluate", {
          returnByValue: true,
          expression: `(()=>{const m=document.querySelector('.pg-img');
            return Boolean(m && m.currentSrc && m.complete && m.naturalWidth);})()`,
        })).result.value;
        if (ready) break;
        await new Promise((r) => setTimeout(r, 150));
      }

      const state = (await send("Runtime.evaluate", {
        returnByValue: true,
        expression: `(()=>{const m=document.querySelector('.pg-img');
          const t=document.querySelectorAll('.pg-thumb')[${i}];
          const r=m.getBoundingClientRect();
          return {main:m.currentSrc, thumb:t.querySelector('img').currentSrc,
                  on:t.classList.contains('is-on'),
                  sel:t.getAttribute('aria-selected'),
                  fit:getComputedStyle(m).objectFit,
                  cssW:r.width, cssH:r.height, alt:m.alt};})()`,
      })).result.value;

      const mainStem = stemOf(state.main);
      const thumbStem = stemOf(state.thumb);
      ok(`thumb ${i + 1} selects its own frame`, mainStem === thumbStem, `${thumbStem} -> ${mainStem}`);
      ok(`thumb ${i + 1} shows as selected`, state.on && state.sel === "true");
      seenStems.push(mainStem);
      seenUrls.push(state.main);

      // Resolution, measured the way audit-image-detail.mjs measures it: the
      // real bytes, not naturalWidth, which lies under a DPR override.
      const d = await realDims(state.main);
      const physW = state.cssW * v.dpr;
      const boxAr = state.cssW / state.cssH;
      const imgAr = d.w / d.h;
      // contain reveals the whole source; cover keeps only the overlap.
      const visW = state.fit === "cover" ? (imgAr > boxAr ? d.w * (boxAr / imgAr) : d.w) : d.w;
      const ppp = visW / physW;
      const crop = Math.round((1 - visW / d.w) * 100);
      ok(`thumb ${i + 1} main image is resolved`, ppp >= 1.0,
        `ppp ${ppp.toFixed(2)} (${d.w}x${d.h}, ${Math.round(physW)} phys, crop ${crop}%)`);
      // The FIRST frame is the one that has to read as a whole bag. A macro
      // detail is allowed to be a macro; a hero that has lost 30% of its
      // width is the failure the client photographed.
      if (i === 0) ok("lead frame is not hard-cropped", crop <= 12, `crop ${crop}%`);
      if (state.alt) ok(`thumb ${i + 1} main image has alt text`, state.alt.trim().length > 8);
    }

    ok("every thumbnail is a different frame", new Set(seenStems).size === n,
      seenStems.join(", "));

    // The real test: different FILES can still be the same PICTURE.
    let worst = { d: 999, pair: "" };
    for (let a = 0; a < seenUrls.length; a++) {
      for (let b = a + 1; b < seenUrls.length; b++) {
        const diff = meanDiff(await fingerprint(seenUrls[a]), await fingerprint(seenUrls[b]));
        if (diff < worst.d) worst = { d: diff, pair: `${seenStems[a]} vs ${seenStems[b]}` };
      }
    }
    if (seenUrls.length > 1) {
      ok("no two frames are near-duplicate pictures", worst.d >= MIN_DIFF,
        `closest pair ${worst.pair} at ${worst.d.toFixed(1)} (floor ${MIN_DIFF})`);
    }
  }
}

close();
try { await fetch(`${CDP}/json/close/${targetId}`); } catch {}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
