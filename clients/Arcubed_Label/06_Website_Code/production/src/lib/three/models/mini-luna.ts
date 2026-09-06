// Mini Luna — geometry built from the measured evidence, DEV ONLY until the
// model is reviewed against the frames it claims to represent.
//
// This is not a downloaded bag mesh with an Arcubed name on it. Every
// dimension below traces to a row in ../blockouts/evidence.ts or to a
// measurement script in scripts/, and each carries the grade of the evidence
// behind it. Where nothing has been measured, the parameter says so rather
// than presenting a guess as a fact.
//
// THE FORM, in one sentence: a flattened oval boat — a wide, low body that is
// a rounded rectangle seen from the front (DSC05774) and an elongated oval
// with a rounded keel seen from above (DSC05775), finished with a thick
// rolled rim and a broad arch handle nearly as wide as the body itself.
//
// Only `three` is imported, so scripts can run this under plain node.
import * as THREE from "three";
import { stitchAt } from "./crochet-texture";

export type Grade =
  | "CONFIRMED_FROM_PHOTOS"
  | "DERIVED_FROM_PHOTOS"
  | "APPROXIMATION_FOR_BLOCKOUT";

export interface Param {
  value: number;
  grade: Grade;
  source: string;
  /** Set when this row corrects an earlier reading — say what changed and why. */
  note?: string;
}

/**
 * All lengths are in body-width units: the body is exactly 1.0 wide.
 * Origin is the CENTRE OF THE RIM PLANE — y=0 at the rim, negative downward.
 */
export const MINI_LUNA_PARAMS = {
  /** Body height below the rim. */
  bodyHeight: {
    value: 1 / 2.34,
    grade: "CONFIRMED_FROM_PHOTOS",
    source: "scripts/measure-products.mjs — body excluding the arch measures 2.34 : 1 wide, the median of five frames across four colourways",
  },
  /** Front-to-back depth of the body at the rim. */
  bodyDepth: {
    value: 0.36,
    grade: "DERIVED_FROM_PHOTOS",
    source: "scripts/measure-rim-aperture.mjs — DSC05774 and DSC05775 solved simultaneously; bracket 0.334-0.381, midpoint 0.358",
  },
  /**
   * Profile exponent n in  halfWidth(t) = (1 - (1 - t)^n)^(1/n),  where t runs
   * 0 at the base to 1 at the rim. n = 2 is a true half-ellipsoid; larger n
   * holds the sides straighter and broadens the base.
   */
  sideFullness: {
    value: 3.6,
    grade: "CONFIRMED_FROM_PHOTOS",
    source: "scripts/fit-body-profile.mjs fits this exponent to the traced silhouette of four frames: DSC05774 = 3.80, DSC04874 = 3.94, DSC04875 = 3.30, DSC04870 = 3.48 (rms 0.044-0.058 over 300-470 rows each). Mean 3.63",
    note: "CORRECTS an earlier reading in this file that asserted n = 2, a true half-ellipsoid, on the argument that bottomCorner = 0.44 implies a half-round base. The fit says otherwise and says so consistently across four frames: Mini Luna has notably straighter sides and a much broader, flatter base than a half-ellipsoid — which is also why the bag sits squarely on a table in every frame instead of resting on a point.",
  },
  /** Wall thickness of the crochet shell. */
  wallThickness: {
    value: 0.045,
    grade: "APPROXIMATION_FOR_BLOCKOUT",
    source: "read by eye off the rim in DSC05775; no measurement exists",
  },
  /** Cross-section radius of the rolled rim band. */
  rimRadius: {
    value: 0.06,
    grade: "DERIVED_FROM_PHOTOS",
    source: "the depth solve's wall sweep is stable across 0.10-0.18 of body width for the full rim band, i.e. a tube radius near 0.06",
  },
  /** Cross-section radius of the handle tube. */
  handleRadius: {
    value: 0.085,
    grade: "CONFIRMED_FROM_PHOTOS",
    source: "evidence.ts handle.thickness — markedly thicker than Vault's, a product-distinguishing feature",
  },
  /** Distance between the handle legs, measured centreline to centreline. */
  handleSpan: {
    value: 0.655 + 2 * 0.085,
    grade: "DERIVED_FROM_PHOTOS",
    source: "the arch's clear opening measures 0.655 of object width in DSC05774 (the most face-on frame; rotation can only narrow an opening, so the maximum across frames is the best estimate). Adding one tube radius on each side converts a clear span to a centreline span. NOTE this REPLACES evidence.ts handle.span = 0.46, which was traced and is wrong by nearly a factor of two — at 0.46 the arch would be a narrow loop instead of an arch nearly as wide as the body",
    note: "OPEN QUESTION, and it must be settled before this model ships. Rendering the model beside DSC04870 (silver & gold) shows a visibly narrower handle and a boxier body in the photograph than in this model, and DSC04870's measured opening is 0.413 against DSC05774's 0.655. That is either camera rotation, or two different SIZES (Regular vs Small are both sold), or two different bags filed under one name. Do not resolve it by averaging — ask Rand which frames are which size.",
  },
  /** Height of the arch apex above the rim. */
  handleRise: {
    value: 0.42,
    grade: "CONFIRMED_FROM_PHOTOS",
    source: "evidence.ts handle.rise — the arch opening's bottom edge sits at 43/43/43/45/46% of total height across five frames, the tightest measurement on any Arcubed product",
  },
  /** How far below the rim the handle legs root into the body. */
  handleRootDrop: {
    value: 0.05,
    grade: "DERIVED_FROM_PHOTOS",
    source: "total height is bodyHeight + handleRise = 0.847; the opening's measured bottom edge at 43-46% of that sits about 0.05 below the rim plane",
  },
  /**
   * Crochet rounds worked up the body. Drives stitch scale only — it changes
   * how the surface reads, never the silhouette.
   */
  bodyRounds: {
    value: 9,
    grade: "APPROXIMATION_FOR_BLOCKOUT",
    source: "counted by eye off DSC05774; not measured, and it affects surface texture only",
  },
} as const satisfies Record<string, Param>;

const P = MINI_LUNA_PARAMS;

/**
 * Rows the dev review must show: everything not CONFIRMED, plus any CONFIRMED
 * row carrying a note — a note on a confirmed row means it corrects an earlier
 * reading or records an open question, and those are exactly the rows a
 * reviewer must not skip.
 */
export function reviewRows(): { key: string; grade: Grade; source: string; note?: string }[] {
  return Object.entries(MINI_LUNA_PARAMS)
    .filter(([, p]) => p.grade !== "CONFIRMED_FROM_PHOTOS" || "note" in p)
    .map(([key, p]) => ({ key, grade: p.grade, source: p.source, note: "note" in p ? p.note : undefined }));
}

/**
 * The body shell: the lower half of an ellipsoid with semi-axes
 * (0.5, bodyHeight, bodyDepth/2), built as a real open vessel — an outer
 * surface, an inset inner surface, and the rim tube joining them — so that
 * looking into the bag from above shows an interior rather than a hollow
 * back face.
 *
 * @param segU segments around the rim
 * @param segV segments from rim down to base
 */
export function bodyGeometry(segU = 272, segV = 96): THREE.BufferGeometry {
  const ax = 0.5;
  const ay = P.bodyHeight.value;
  const az = P.bodyDepth.value / 2;
  const t = P.wallThickness.value;
  const n = P.sideFullness.value;

  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];

  /** Fitted profile: half-width at height fraction `hf` above the base. */
  const halfWidth = (hf: number) =>
    Math.pow(Math.max(0, 1 - Math.pow(1 - hf, n)), 1 / n);

  // inset === 0 builds the outer surface; inset === 1 the inner one.
  const addShell = (inset: 0 | 1) => {
    const base = pos.length / 3;
    const sx = inset ? ax - t : ax;
    const sz = inset ? az - t : az;
    const sy = inset ? ay - t : ay;
    for (let j = 0; j <= segV; j++) {
      // Sample denser near the base, where the fitted profile turns hardest.
      const hf = Math.pow(j / segV, 1.6);
      const h = halfWidth(hf);
      const y = -sy * (1 - hf);
      for (let i = 0; i <= segU; i++) {
        const phi = (i / segU) * Math.PI * 2;
        pos.push(sx * h * Math.cos(phi), y, sz * h * Math.sin(phi));
        // u wraps around the body, v runs down it — so a stitch texture's
        // rows follow the crochet rounds.
        uv.push(i / segU, hf);
      }
    }
    for (let j = 0; j < segV; j++) {
      for (let i = 0; i < segU; i++) {
        const a = base + j * (segU + 1) + i;
        const b = a + segU + 1;
        // Opposite winding on the inner shell, so computeVertexNormals()
        // turns its normals inward without a hand-written normal formula —
        // the previous analytic normal was ellipsoid-specific and became
        // wrong the moment the profile stopped being an ellipse.
        if (inset) idx.push(a, b, a + 1, a + 1, b, b + 1);
        else idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  };
  addShell(0);
  addShell(1);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Push every vertex out along its normal by the stitch height at its UV.
 *
 * This is the difference between a bag that looks crocheted and one that
 * looks like a smooth shape with a fabric picture on it: chunky crochet
 * breaks its OWN OUTLINE, and no normal map can do that — the silhouette
 * stays glassy no matter how good the shading is. `stitchAt` is the same
 * function the colour and normal maps are built from, so relief and shading
 * agree instead of drifting apart.
 *
 * @param repeat how many times the stitch sheet tiles across this part's UVs
 * @param amp displacement in body-width units
 */
export function displaceCrochet(
  g: THREE.BufferGeometry,
  cols: number,
  rows: number,
  repeat: [number, number],
  amp: number,
  /**
   * Optional per-UV scale on the displacement. The body needs it: its rings
   * collapse to a point at the base, so a full-amplitude bump there becomes a
   * spike radiating off the pole.
   */
  fade?: (u: number, v: number) => number
): THREE.BufferGeometry {
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");
  const uv = g.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) {
    const h = stitchAt(
      ((uv.getX(i) * repeat[0]) % 1 + 1) % 1,
      ((uv.getY(i) * repeat[1]) % 1 + 1) % 1,
      cols,
      rows
    );
    // Centred on the mid-height of a stitch, so displacement adds relief
    // without inflating the overall silhouette away from the measurements.
    const d = (h - 0.5) * amp * (fade ? fade(uv.getX(i), uv.getY(i)) : 1);
    pos.setXYZ(i, pos.getX(i) + nor.getX(i) * d, pos.getY(i) + nor.getY(i) * d, pos.getZ(i) + nor.getZ(i) * d);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/**
 * TubeGeometry lays u ALONG the tube and v around it — the opposite of the
 * body, where v runs down the rounds. Without this swap a crochet texture
 * renders as long stripes running the length of the handle instead of rounds
 * wrapping around it.
 */
function swapUV(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) {
    const x = uv.getX(i), y = uv.getY(i);
    uv.setXY(i, y, x);
  }
  uv.needsUpdate = true;
  return g;
}

/** The rolled rim band: a tube swept around the rim ellipse. */
export function rimGeometry(segU = 320, segRadial = 40): THREE.BufferGeometry {
  const ax = 0.5 - P.wallThickness.value / 2;
  const az = P.bodyDepth.value / 2 - P.wallThickness.value / 2;
  const r = P.rimRadius.value;

  class RimCurve extends THREE.Curve<THREE.Vector3> {
    constructor() { super(); }
    getPoint(u: number, target = new THREE.Vector3()) {
      const phi = u * Math.PI * 2;
      return target.set(ax * Math.cos(phi), 0, az * Math.sin(phi));
    }
  }
  // NOT swapped, unlike the handle. The rim is the body's last round: its
  // stitches march AROUND the bag, i.e. along this tube's length, and the
  // round direction wraps its small cross-section. The handle is the opposite
  // — a tube worked in rounds along its own length — which is why only that
  // one is swapped.
  return new THREE.TubeGeometry(new RimCurve(), segU, r, segRadial, true);
}

/**
 * The arch handle: a tube following a semi-ellipse in the long-axis plane,
 * rooted just below the rim on both sides.
 */
export function handleGeometry(segLength = 300, segRadial = 44): THREE.BufferGeometry {
  const halfSpan = P.handleSpan.value / 2;
  const rise = P.handleRise.value;
  const root = -P.handleRootDrop.value;

  class ArchCurve extends THREE.Curve<THREE.Vector3> {
    constructor() { super(); }
    getPoint(u: number, target = new THREE.Vector3()) {
      const a = u * Math.PI;
      return target.set(-halfSpan * Math.cos(a), root + (rise - root) * Math.sin(a), 0);
    }
  }
  return swapUV(new THREE.TubeGeometry(new ArchCurve(), segLength, P.handleRadius.value, segRadial, false));
}

/** Overall bounding height, rim-relative: base at -bodyHeight, apex at +rise. */
export const MINI_LUNA_TOTAL_HEIGHT = P.bodyHeight.value + P.handleRise.value;
