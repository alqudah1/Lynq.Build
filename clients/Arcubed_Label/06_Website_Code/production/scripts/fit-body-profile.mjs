// Fit Mini Luna's body profile exponent to the photographed silhouette.
//
// The body is modelled as a superellipsoid of revolution: at a height t above
// the base (0 at base, 1 at the rim) the half-width is
//     w(t) = (1 - (1 - t)^n)^(1/n)
// n = 2 is a true half-ellipsoid; larger n holds the sides straighter and
// broadens the base. This finds the n that best matches the real outline
// instead of assuming one.
import sharp from "sharp";

const FRAMES = ["DSC05774", "DSC04874", "DSC04875", "DSC04870"];

async function profile(id) {
  const { data, info } = await sharp(`public/media/${id}-cut-1200.webp`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const A = (x, y) => data[(y * W + x) * C + 3];
  const rows = [];
  for (let y = 0; y < H; y++) {
    let lo = -1, hi = -1;
    for (let x = 0; x < W; x++) if (A(x, y) > 200) { if (lo < 0) lo = x; hi = x; }
    rows.push(lo < 0 ? null : { y, lo, hi, w: hi - lo + 1 });
  }
  const solid = rows.filter(Boolean);
  const top = solid[0].y, bot = solid[solid.length - 1].y;

  // The body starts below the arch. The widest row in the lower 60% is the
  // rim; everything below it is body.
  const lower = solid.filter((r) => r.y > top + (bot - top) * 0.35);
  const rim = lower.reduce((a, b) => (a.w >= b.w ? a : b));
  const body = solid.filter((r) => r.y >= rim.y);
  const maxW = rim.w;
  const hBody = bot - rim.y;
  // Drop the last few rows: the contact shadow merges into the object there.
  return { id, maxW, hBody, samples: body.filter((r) => r.y < bot - hBody * 0.06).map((r) => ({ t: 1 - (r.y - rim.y) / hBody, w: r.w / maxW })) };
}

function fit(samples) {
  let best = null;
  for (let n = 1.4; n <= 6.01; n += 0.02) {
    let err = 0;
    for (const s of samples) {
      const model = Math.pow(Math.max(0, 1 - Math.pow(1 - s.t, n)), 1 / n);
      err += (model - s.w) ** 2;
    }
    const rms = Math.sqrt(err / samples.length);
    if (!best || rms < best.rms) best = { n, rms };
  }
  return best;
}

const all = [];
for (const id of FRAMES) {
  const p = await profile(id);
  const f = fit(p.samples);
  all.push(f.n);
  console.log(`${id}  body ${p.maxW} x ${p.hBody} px (W:H ${(p.maxW / p.hBody).toFixed(2)})  best n = ${f.n.toFixed(2)}  rms ${f.rms.toFixed(4)}  (${p.samples.length} rows)`);
}
all.sort((a, b) => a - b);
console.log(`\nmedian n = ${all[Math.floor(all.length / 2)].toFixed(2)}   range ${all[0].toFixed(2)} - ${all[all.length - 1].toFixed(2)}`);
console.log("n = 2 would be a true half-ellipsoid.");
