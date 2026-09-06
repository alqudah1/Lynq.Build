// Generate pure-form silhouette masks from the approved cut-outs.
//
// WHY THESE EXIST: the homepage's "shape" moment puts each bag on the navy
// field. Compositing a normal cut-out there fails — the matte was built
// against a light studio seamless, so its soft edge and contact shadow read
// as a white glow on a dark background (verified by eye before writing this).
// Reducing each bag to a hard-thresholded alpha removes both problems and
// says the thing that moment is actually about: every Arcubed bag has its own
// form.
//
// Threshold 200/255 was chosen by comparing 200, 235 and 252: above ~235 the
// crochet's open stitches start eroding holes into Nova, and below ~200 the
// contact shadow starts creeping back in as a smear under the bag.
//
// Loco's silhouette is deliberately ragged. Its cut-out failed QA for
// PHOTOGRAPHIC use (REJECTED_CUTOUTS in scripts/media-manifest.mjs) because
// the fringe defeats a clean matte — but as a silhouette that ragged lower
// edge is the truth about the product, not an artefact to hide.
//
// Usage: node scripts/build-silhouettes.mjs
import sharp from "sharp";

const THRESHOLD = 200;
const SOURCES = {
  "mini-luna": "DSC05774",
  "nova": "DSC05786",
  "vault": "DSC05792",
  "loco": "DSC05765",
};

for (const [slug, id] of Object.entries(SOURCES)) {
  const src = `public/media/${id}-cut-1200.webp`;
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const out = Buffer.alloc(width * height * 4);
  let solid = 0;
  for (let i = 0; i < width * height; i++) {
    const a = data[i * channels + 3];
    const on = a >= THRESHOLD;
    if (on) solid++;
    // White body: the asset is used as a CSS mask, so only alpha matters and
    // the page picks the fill colour.
    out[i * 4] = 255; out[i * 4 + 1] = 255; out[i * 4 + 2] = 255;
    out[i * 4 + 3] = on ? 255 : 0;
  }
  // Trim to the shape's own bounds so layout can position by the form itself
  // rather than by whatever margin the original frame happened to have.
  const dst = `public/media/silhouette-${slug}.webp`;
  const img = sharp(out, { raw: { width, height, channels: 4 } }).png();
  const trimmed = await sharp(await img.toBuffer()).trim({ threshold: 1 }).webp({ quality: 90, alphaQuality: 100 }).toBuffer();
  const meta = await sharp(trimmed).metadata();
  await sharp(trimmed).toFile(dst);
  console.log(`${slug.padEnd(10)} <- ${id}  ${meta.width}x${meta.height}  ratio ${(meta.width / meta.height).toFixed(4)}  ${(100 * solid / (width * height)).toFixed(1)}% solid`);
}
