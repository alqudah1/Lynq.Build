// Transparent wordmarks, keyed from the client's original 2646x756 artwork.
//
// The supplied files are flat brand grounds with the logotype knocked out:
// "ARCUBED LOGO" is pink ink on navy, "ARCUBED LOGO2" is navy ink on pink.
// Neither has alpha. The wordmark in production was a 1116px derivative of
// these — a 2.4x downscale of an already hairline logotype (ink covers only
// 3% of the canvas), which is why it read as faint rather than fine.
//
// Keyed by distance from the known ground colour toward the known ink colour,
// with the ink written flat. For a single-colour logotype that is exactly
// right: it recovers true anti-aliasing without carrying any of the ground's
// colour into the edge, so the mark stays crisp on pink, navy OR white.
//
// The artwork itself is not altered. Usage: node scripts/build-logo.mjs
import sharp from "sharp";

const NAVY = [0x14, 0x35, 0x62];
const PINK = [0xff, 0xe0, 0xfd];

async function key(srcFile, ground, ink, outFile) {
  const { data, info } = await sharp(srcFile).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const span = Math.hypot(ink[0] - ground[0], ink[1] - ground[1], ink[2] - ground[2]);
  const out = Buffer.alloc(W * H * 4);
  let x0 = W, x1 = 0, y0 = H, y1 = 0;
  for (let i = 0; i < W * H; i++) {
    const o = i * C;
    const d = Math.hypot(data[o] - ground[0], data[o + 1] - ground[1], data[o + 2] - ground[2]);
    const a = Math.max(0, Math.min(255, Math.round((d / span) * 255)));
    const q = i * 4;
    out[q] = ink[0]; out[q + 1] = ink[1]; out[q + 2] = ink[2]; out[q + 3] = a;
    if (a > 24) { const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  // Trim the generous artboard margin so the mark can be positioned by its own
  // edges rather than by whatever padding the artwork happened to carry.
  const pad = Math.round((y1 - y0) * 0.06);
  const region = {
    left: Math.max(0, x0 - pad), top: Math.max(0, y0 - pad),
    width: Math.min(W - Math.max(0, x0 - pad), x1 - x0 + 1 + pad * 2),
    height: Math.min(H - Math.max(0, y0 - pad), y1 - y0 + 1 + pad * 2),
  };
  await sharp(out, { raw: { width: W, height: H, channels: 4 } }).extract(region).png({ compressionLevel: 9 }).toFile(outFile);
  const m = await sharp(outFile).metadata();
  console.log(`${outFile.split("/").pop().padEnd(30)} ${m.width}x${m.height}  (from ${W}x${H})`);
}

await key("../../02_Branding/ARCUBED LOGO2 - FAIRMONT.png", PINK, NAVY, "public/brand/arcubed-wordmark-navy.png");
await key("../../02_Branding/ARCUBED LOGO - FAIRMONT.png", NAVY, PINK, "public/brand/arcubed-wordmark-pink.png");
