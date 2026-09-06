// Procedural crochet surface — generated, never a downloaded fabric photo.
//
// A crochet round is a line of interlocking loops, each leaning against its
// neighbour, with the next round offset by half a stitch. That is the whole
// pattern, and it is what makes a surface read as crochet rather than as knit
// or as generic cloth: staggered rows of bumps, with a groove between rounds
// where the yarn passes through the round below.
//
// A normal map alone is not enough. Real crochet is mostly SHADOW: the deep
// channels between stitches are what the eye uses to read the stitch, and a
// normal map under a bright studio environment washes straight out — which is
// exactly what happened on the first attempt, where the body rendered as a
// bleached grey dome. So one height field drives three maps: colour (with the
// between-stitch shadow baked in), normal, and roughness.
//
// Everything is a DataTexture built in plain JS, so it works identically on
// the server, in a script and in the browser with no canvas.
import * as THREE from "three";

/**
 * One stitch's height at local coordinates within its cell, 0..1.
 *
 * A worked stitch is a short vertical post, not a bead: it is taller than it
 * is wide, it TOUCHES its neighbours on both sides, and it carries a crease
 * down the middle where the two legs of the loop meet. Modelling it as an
 * isolated round lobe is what made the first pass read as a beaded curtain
 * rather than as crochet.
 */
export function stitchHeight(sx: number, sy: number): number {
  // Superellipse: the fourth power in x squares the sides off, so stitches
  // meet edge to edge instead of leaving a gap between circles.
  const dx = (sx - 0.5) / 0.56;
  const dy = (sy - 0.5) / 0.76;
  const d = dx * dx * dx * dx + dy * dy;
  if (d >= 1) return 0;
  // A low exponent keeps the crown broad and the sides steep, so a round
  // reads as a continuous ridge. Rounds that separate into discrete blobs
  // look like popcorn, not fabric — which is what a tall, narrow cell gave.
  const body = Math.pow(1 - d, 0.38);
  // The crease between the two legs of the loop.
  const c = (sx - 0.5) / 0.12;
  return body * (1 - 0.38 * Math.exp(-c * c));
}

/**
 * Stitch height at texture coordinates (u, v) for a `cols` x `rows` sheet.
 * The geometry displacement and the maps read the SAME function, so the bumps
 * you see in the silhouette are the bumps the shading is lighting.
 */
export function stitchAt(u: number, v: number, cols: number, rows: number): number {
  const row = Math.floor(v * rows);
  const sy = v * rows - row;
  const cell = u * cols + (row % 2) * 0.5;
  const col = Math.floor(cell);
  // Hand-worked stitches are never identical. A deterministic per-stitch
  // wobble in height and placement is the difference between a piece of
  // fabric and a machined lattice — and it costs nothing, because the same
  // hash is read by the displacement and by the maps.
  const h1 = hash2(col, row);
  const h2 = hash2(col + 977, row + 331);
  const shifted = cell - col + (h2 - 0.5) * 0.16;
  return stitchHeight(shifted - Math.floor(shifted + 1) + 1, sy) * (0.86 + 0.28 * h1);
}

/** Deterministic 0..1 hash of two small integers. */
function hash2(a: number, b: number): number {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Height field for `cols` stitches by `rows` rounds, rounds offset by half. */
function heightField(cols: number, rows: number, size: number): Float32Array {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    const row = Math.floor(v * rows);
    const sy = v * rows - row;
    const offset = (row % 2) * 0.5;
    for (let x = 0; x < size; x++) {
      const cell = (x / size) * cols + offset;
      h[y * size + x] = stitchHeight(cell - Math.floor(cell), sy);
    }
  }
  return h;
}

function tex(data: Uint8Array, size: number, colorSpace: THREE.ColorSpace): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = colorSpace;
  t.needsUpdate = true;
  return t;
}

export interface CrochetMaps {
  color: THREE.DataTexture;
  normal: THREE.DataTexture;
  roughness: THREE.DataTexture;
}

/**
 * Build all three maps for one colourway.
 *
 * Silver & Gold is ALTERNATING HORIZONTAL BANDS, one round of each, across
 * the body AND the handle — confirmed by comparing DSC04870 (silver & gold)
 * against the single-colour DSC04874. It is NOT a top half / bottom half
 * split, which is what a naive primary/secondary material assignment gives.
 * Band WIDTH is read off DSC04870 as roughly two rounds per colour; it has
 * not been counted stitch by stitch, so treat it as an approximation.
 *
 * @param cols stitches around one horizontal repeat
 * @param rows rounds up one vertical repeat
 */
export function crochetMaps(
  primary: string,
  secondary: string | null,
  cols = 26,
  rows = 9,
  size = 512,
  /** Rounds each colour holds before alternating. */
  bandRounds = 2
): CrochetMaps {
  const h = heightField(cols, rows, size);
  const a = new THREE.Color(primary);
  const b = new THREE.Color(secondary ?? primary);

  const colour = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const norm = new Uint8Array(size * size * 4);

  // How dark the deepest channel between stitches goes. Crochet in a shiny
  // ribbon yarn still reads almost black in the channels, which is what keeps
  // the stitch visible when the lit faces blow out.
  const SHADOW = 0.52;
  const STRENGTH = 2.4;

  for (let y = 0; y < size; y++) {
    const row = Math.floor((y / size) * rows);
    const band = Math.floor(row / bandRounds) % 2 === 0 ? a : b;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const o = i * 4;
      const t = h[i];
      const shade = SHADOW + (1 - SHADOW) * t;
      colour[o] = Math.round(Math.min(1, band.r * shade) * 255);
      colour[o + 1] = Math.round(Math.min(1, band.g * shade) * 255);
      colour[o + 2] = Math.round(Math.min(1, band.b * shade) * 255);
      colour[o + 3] = 255;

      // Channels are rougher than the crowns: yarn catches light on the tops
      // of the stitches and goes matte where it turns away.
      const r = 0.78 - 0.46 * t;
      rough[o] = rough[o + 1] = rough[o + 2] = Math.round(r * 255);
      rough[o + 3] = 255;

      const l = h[y * size + ((x - 1 + size) % size)];
      const rr = h[y * size + ((x + 1) % size)];
      const d = h[((y - 1 + size) % size) * size + x];
      const u = h[((y + 1) % size) * size + x];
      let nx = (l - rr) * STRENGTH;
      let ny = (d - u) * STRENGTH;
      const len = Math.hypot(nx, ny, 1);
      nx /= len; ny /= len;
      norm[o] = Math.round((nx * 0.5 + 0.5) * 255);
      norm[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      norm[o + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      norm[o + 3] = 255;
    }
  }

  return {
    color: tex(colour, size, THREE.SRGBColorSpace),
    normal: tex(norm, size, THREE.NoColorSpace),
    roughness: tex(rough, size, THREE.NoColorSpace),
  };
}

/**
 * Surface finish per colourway.
 *
 * Mini Luna's Red is photographed in a SHINY METALLIC ribbon yarn
 * (PRODUCT-GEOMETRY-MAP.md row 6, CONFIRMED FROM PHOTOS) — the same finish as
 * Silver and Gold. A matte-yarn default would be wrong for this product.
 *
 * Metalness is deliberately well below 1: the yarn is a metallised film, not
 * bare metal, and a fully metallic surface takes ALL its colour from the
 * environment — which is what bleached the first render to grey.
 */
export const METALLIC_FINISH = { metalness: 0.42, envMapIntensity: 1.0 } as const;
export const MATTE_FINISH = { metalness: 0.0, envMapIntensity: 0.5 } as const;
