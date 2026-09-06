// Measure Mini Luna's rim aperture, and from it recover the front-to-back
// depth that no single frame can show.
//
// WHY THIS IS POSSIBLE AT ALL
// The rim aperture is a planar ellipse lying in a horizontal plane. Seen from
// a camera tilted theta above that plane, its long axis (horizontal, square to
// the camera) projects at true length, while its short axis — the depth —
// projects foreshortened by sin(theta). One frame therefore gives
//     m = (D_inner / W) * sin(theta)
// which is one equation in two unknowns. The second equation comes from the
// body silhouette in the SAME frame: a body of true height Hb and depth D
// projects to an apparent height
//     A = (Hb / W) * cos(theta) + (D / W) * sin(theta)
// so measuring both m and A per frame pins theta and D together, using only
// quantities read off that frame plus one shared constant (the true height
// ratio, taken from the least-tilted frame in the set).
//
// This is still photogrammetry from uncalibrated frames, not a tape measure
// on the physical bag. The output is graded accordingly by the caller.
//
// Usage: node scripts/measure-rim-aperture.mjs
import sharp from "sharp";
import { readFileSync } from "node:fs";

const FRAMES = ["DSC04870", "DSC04871", "DSC04872", "DSC04873", "DSC04874", "DSC04875", "DSC05774", "DSC05775"];
const measured = JSON.parse(readFileSync(".blockouts/measurements.json", "utf8"))["mini-luna"];

/** Largest dark connected component inside the alpha mask = the bag interior. */
async function aperture(id) {
  const { data, info } = await sharp(`public/media/${id}-cut-1200.webp`)
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const A = (x, y) => data[(y * W + x) * C + 3];
  const L = (x, y) => { const i = (y * W + x) * C; return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; };

  let x0 = W, x1 = 0, y0 = H, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if (A(x, y) > 200) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const bagW = x1 - x0 + 1, bagH = y1 - y0 + 1;

  const lum = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (A(x, y) > 200) lum.push(L(x, y));
  lum.sort((a, b) => a - b);
  const thresh = lum[Math.floor(0.16 * (lum.length - 1))];

  const seen = new Uint8Array(W * H);
  let best = null;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x;
    if (seen[i] || A(x, y) <= 200 || L(x, y) > thresh) continue;
    const st = [i]; seen[i] = 1;
    let n = 0, ax0 = W, ax1 = 0, ay0 = H, ay1 = 0;
    while (st.length) {
      const p = st.pop(), py = (p / W) | 0, px = p % W; n++;
      if (px < ax0) ax0 = px; if (px > ax1) ax1 = px; if (py < ay0) ay0 = py; if (py > ay1) ay1 = py;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + dx, ny = py + dy;
        if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
        const ni = ny * W + nx;
        if (seen[ni] || A(nx, ny) <= 200 || L(nx, ny) > thresh) continue;
        seen[ni] = 1; st.push(ni);
      }
    }
    if (!best || n > best.n) best = { n, ax0, ax1, ay0, ay1 };
  }
  if (!best) return null;
  return {
    bagW, bagH,
    apW: best.ax1 - best.ax0 + 1,
    apH: best.ay1 - best.ay0 + 1,
    // Where the component's centre sits in the object box. The rim aperture is
    // in the upper half; a component low in the box is a shadow, not the rim.
    cy: ((best.ay0 + best.ay1) / 2 - y0) / bagH,
    fill: best.n / ((best.ax1 - best.ax0 + 1) * (best.ay1 - best.ay0 + 1)),
  };
}

const rows = [];
for (const id of FRAMES) {
  const ap = await aperture(id);
  const mrow = measured.find((r) => r.frame === id);
  if (!ap || !mrow) { rows.push({ id, skip: "no aperture or no measurement row" }); continue; }
  rows.push({
    id,
    m: ap.apW ? ap.apH / ap.bagW : null,     // apparent depth, normalised by bag width
    apRatio: ap.apH / ap.apW,
    apMajorFrac: ap.apW / ap.bagW,
    A: 1 / mrow.bodyWidthHeight,             // apparent body height / width
    cy: ap.cy,
    fill: ap.fill,
  });
}

// SOLVE
// Two frames that both resolve the rim give three equations in three unknowns,
// because the bag's depth is the same object in both:
//     A1 - m1 = a0*cos(t1) + WALL*sin(t1)
//     A2 - m2 = a0*cos(t2) + WALL*sin(t2)
//     m1/sin(t1) = m2/sin(t2)        (same inner depth seen from both angles)
// Unknowns: a0 (the untilted height ratio), t1, t2. Substituting the third
// into the first two leaves one equation in sin(t1), solved by bisection.
//
// A single frame CANNOT do this: one frame has two unknowns and one equation,
// which is why the earlier single-reference attempt silently depended on
// whichever frame was nominated as "frontal".

/** Rim wall: the rolled band adds this much to depth beyond the inner aperture. */
function solve(f1, f2, WALL) {
  const k = f2.m / f1.m;                     // sin(t2)/sin(t1)
  if (k <= 1) return null;                   // f2 must be the more tilted frame
  const resid = (s1) => {
    const s2 = k * s1;
    if (s2 >= 1) return NaN;
    const c1 = Math.sqrt(1 - s1 * s1), c2 = Math.sqrt(1 - s2 * s2);
    // a0 from frame 1, then check frame 2.
    const a0 = (f1.A - f1.m - WALL * s1) / c1;
    return (f2.A - f2.m) - (a0 * c2 + WALL * s2);
  };
  let lo = 0.02, hi = Math.min(0.98, 1 / k - 1e-6);
  let flo = resid(lo);
  if (!Number.isFinite(flo)) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, fm = resid(mid);
    if (!Number.isFinite(fm)) { hi = mid; continue; }
    if ((flo < 0) === (fm < 0)) { lo = mid; flo = fm; } else hi = mid;
  }
  const s1 = (lo + hi) / 2;
  if (!Number.isFinite(resid(s1)) || Math.abs(resid(s1)) > 5e-3) return null;
  const a0 = (f1.A - f1.m - WALL * s1) / Math.sqrt(1 - s1 * s1);
  return {
    t1: (Math.asin(s1) * 180) / Math.PI,
    t2: (Math.asin(k * s1) * 180) / Math.PI,
    a0,
    innerDepth: f1.m / s1,
    depthRatio: f1.m / s1 + WALL,
  };
}

const usable = rows.filter((r) => !r.skip && r.cy > 0.2 && r.cy < 0.62 && r.fill > 0.35);

console.log("frame      m(app.depth)  apRatio  majorFrac  A(app.h/w)  cy    fill   rim resolved");
for (const r of rows) {
  if (r.skip) { console.log(`${r.id}   ${r.skip}`); continue; }
  const ok = usable.includes(r);
  console.log(
    `${r.id}   ${r.m.toFixed(3)}        ${r.apRatio.toFixed(3)}    ${r.apMajorFrac.toFixed(3)}      ${r.A.toFixed(3)}     ${r.cy.toFixed(2)}  ${r.fill.toFixed(2)}   ` +
    (ok ? "yes" : "no  (darkest region is the contact shadow, not the rim)")
  );
}

if (usable.length < 2) {
  console.log("\nFewer than two frames resolve the rim — depth stays UNRESOLVED.");
  process.exit(0);
}
usable.sort((a, b) => a.m - b.m);
const f1 = usable[0], f2 = usable[usable.length - 1];
console.log(`\nSolving from ${f1.id} (less tilted) and ${f2.id} (more tilted).`);

// The rim-wall constant is read off a photograph by eye, so its effect on the
// answer is swept rather than hidden.
console.log("\nWALL   theta1  theta2   a0(untilted h/w)  inner D/W   D/W");
const out = [];
for (const WALL of [0.10, 0.12, 0.14, 0.16, 0.18]) {
  const r = solve(f1, f2, WALL);
  if (!r) { console.log(`${WALL.toFixed(2)}   no solution`); continue; }
  out.push(r.depthRatio);
  console.log(`${WALL.toFixed(2)}   ${r.t1.toFixed(1)}deg  ${r.t2.toFixed(1)}deg   ${r.a0.toFixed(3)} (${(1 / r.a0).toFixed(2)}:1)      ${r.innerDepth.toFixed(3)}      ${r.depthRatio.toFixed(3)}`);
}
if (out.length) {
  out.sort((a, b) => a - b);
  console.log(`\nD/W bracket across the wall sweep: ${out[0].toFixed(3)} - ${out[out.length - 1].toFixed(3)}  (midpoint ${((out[0] + out[out.length - 1]) / 2).toFixed(3)})`);
  console.log("Two frames, uncalibrated camera, one constant read by eye: a derivation, NOT a measurement of the physical bag.");
}
