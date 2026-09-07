// Field-safe cut-outs for the collection tiles.
//
// THE PROBLEM these solve: the storefront cut-outs were matted against a
// light studio seamless. Two separate artefacts come from that, and they read
// as one milky halo once the bag is placed on a mid-tone colour field:
//
//   1. COLOUR CONTAMINATION on the anti-aliased rim. Partially transparent
//      pixels still carry the seamless's colour mixed in, so a bag whose body
//      averages luminance 126 has an edge band averaging 199. Composited over
//      a mid-tone field that rim stays pale — a visible outline.
//
//   2. THE CONTACT SHADOW, which survives as a broad, low-alpha, LIGHT-GREY
//      region under the bag. On the studio seamless it is a shadow. On a
//      coloured field it is a pale smear, because it is lighter than the
//      field it now sits on. It is also simply wrong: the bag is not standing
//      on that colour.
//
// The fix is not a harder threshold — that eats the crochet's open stitches
// (checked while building the silhouettes: above ~235 alpha, holes appear in
// Nova). Instead:
//   · keep the rim, but UNMIX the background out of it
//   · keep alpha only within a few pixels of the solid body, which drops the
//     contact shadow while leaving every anti-aliased edge pixel intact
//
// Nothing inside the object is touched, so no stitch is altered.
//
// Usage: node scripts/build-tile-cutouts.mjs
import sharp from "sharp";

/** Alpha at or above this is unambiguously object (same value the silhouettes use). */
const SOLID = 200;
/** How far outside the solid body the anti-aliased rim is allowed to live. */
const RIM_PX = 3;

// Every frame whose cut-out passed QA, read from the manifest rather than
// listed by hand — so a frame added there cannot silently miss a tile asset
// and 404 when the collection asks for one.
const { COLOUR_MEDIA, EDITORIAL_ONLY } = await import("../src/lib/media-manifest.ts");
const SOURCES = [
  ...Object.values(COLOUR_MEDIA).flatMap((p) => Object.values(p).flat()),
  ...Object.values(EDITORIAL_ONLY).flat(),
].filter((f) => f.cutOk).map((f) => f.frameId);

/**
 * The seamless colour, read from the ORIGINAL photograph rather than from the
 * cut-out. A cut-out's fully transparent pixels have had their RGB zeroed by
 * the encoder, so sampling them returns black — which then unmixes the rim in
 * exactly the wrong direction. Confirmed the hard way: the first run reported
 * rgb(0,0,0) for thirteen of fourteen assets.
 */
async function backgroundColour(id) {
  const { data, info } = await sharp(`public/media/${id}-1600.webp`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const rs = [], gs = [], bs = [];
  const band = Math.max(4, Math.round(Math.min(W, H) * 0.03));
  for (let y = 0; y < band; y++) {
    for (let x = 0; x < W; x += 3) {
      for (const yy of [y, H - 1 - y]) {
        const i = (yy * W + x) * C;
        rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
      }
    }
  }
  const med = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
  return [med(rs), med(gs), med(bs)];
}

for (const id of SOURCES) {
  // Sources the high-resolution cut-out (scripts/build-hires.mjs) so the
  // de-haloed tiles carry the same real detail as everything else.
  const src = `public/media/${id}-cut-2400.webp`;
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const bg = await backgroundColour(id);

  // Solid body, then a distance-limited dilation to define the rim zone.
  const solid = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) solid[i] = data[i * C + 3] >= SOLID ? 1 : 0;

  const near = new Uint8Array(solid);
  let front = [];
  for (let i = 0; i < W * H; i++) if (solid[i]) front.push(i);
  for (let step = 0; step < RIM_PX; step++) {
    const next = [];
    for (const p of front) {
      const x = p % W, y = (p / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (!near[ni]) { near[ni] = 1; next.push(ni); }
      }
    }
    front = next;
  }

  // Bounding box of everything the mask kept, so the contact zone can be
  // expressed relative to the object rather than to the frame.
  let by0 = H, by1 = 0;
  for (let i = 0; i < W * H; i++) {
    if (near[i] && data[i * C + 3] > 16) { const y = (i / W) | 0; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  }
  // Where the bag meets the seamless, the background model fails: a strip of
  // lit seamless directly under the base is kept as FULLY OPAQUE object, and
  // it composites onto a colour field as a hard cream band under every bag.
  // It cannot be unmixed away — it is alpha 255. It is removed here by
  // colour, and only within the contact zone, so no stitch anywhere else in
  // the object can be touched by this rule.
  const contactFrom = by1 - Math.round((by1 - by0) * 0.16);
  const NEAR_BG = 46;

  // Seamless also survives INSIDE the handle openings: the background model
  // cannot tell an enclosed patch of studio backdrop from the product around
  // it, so Vault and Mini Luna kept a white blob in their grips.
  //
  // Removing every background-coloured pixel is not an option — a silver bag
  // IS close to a cream seamless in colour (about 29 apart in RGB, well
  // inside the threshold), and a blanket rule would erase the whole bag. So
  // background-coloured regions are grouped, and only SMALL ones are dropped:
  // a trapped patch in a handle slot is around a tenth of the object, a
  // silver bag's body is most of it.
  const objArea = (() => { let n = 0; for (let i = 0; i < W * H; i++) if (near[i] && data[i * C + 3] > 16) n++; return n; })();
  const isBgish = (i) => {
    if (!near[i] || data[i * C + 3] < 200) return false;
    const s2 = i * C;
    return Math.hypot(data[s2] - bg[0], data[s2 + 1] - bg[1], data[s2 + 2] - bg[2]) < NEAR_BG;
  };
  const killPatch = new Uint8Array(W * H);
  {
    const seen = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      if (seen[i] || !isBgish(i)) continue;
      const stack = [i]; seen[i] = 1; const members = [];
      while (stack.length) {
        const q = stack.pop(); members.push(q);
        const x = q % W, y = (q / W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (seen[ni] || !isBgish(ni)) continue;
          seen[ni] = 1; stack.push(ni);
        }
      }
      if (members.length < objArea * 0.11) for (const m of members) killPatch[m] = 1;
    }
  }

  const out = Buffer.alloc(W * H * 4);
  let dropped = 0, fixed = 0, contact = 0, patched = 0;
  for (let i = 0; i < W * H; i++) {
    const o = i * 4, s = i * C;
    const a = data[s + 3];
    if (!near[i]) {
      // Outside the rim zone: contact shadow and stray matte. Discarded.
      if (a > 8) dropped++;
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
      continue;
    }
    if (killPatch[i]) {
      patched++;
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
      continue;
    }
    const y = (i / W) | 0;
    if (y >= contactFrom) {
      const d = Math.hypot(data[s] - bg[0], data[s + 1] - bg[1], data[s + 2] - bg[2]);
      if (d < NEAR_BG) {
        contact++;
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
        continue;
      }
    }
    if (a >= 250) {
      out[o] = data[s]; out[o + 1] = data[s + 1]; out[o + 2] = data[s + 2]; out[o + 3] = a;
      continue;
    }
    // Unmix: observed = a*object + (1-a)*background  ->  solve for object.
    const af = a / 255;
    fixed++;
    for (let c = 0; c < 3; c++) {
      const v = (data[s + c] - (1 - af) * bg[c]) / Math.max(af, 0.08);
      out[o + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
    out[o + 3] = a;
  }

  const dst = `public/media/${id}-tile-2400.webp`;
  await sharp(out, { raw: { width: W, height: H, channels: 4 } })
    .webp({ quality: 92, alphaQuality: 100 }).toFile(dst);
  const small = `public/media/${id}-tile-600.webp`;
  await sharp(out, { raw: { width: W, height: H, channels: 4 } })
    .resize({ width: 600 }).webp({ quality: 90, alphaQuality: 100 }).toFile(small);
  console.log(`${id}  bg rgb(${bg.join(",")})  rim-unmixed ${fixed}  shadow ${dropped}  contact-strip ${contact}  trapped-patches ${patched}`);
}
