// Arcubed blockout evidence table — DEV ONLY, NOT PRODUCTION GEOMETRY.
//
// Every number that shapes a blockout is declared here with the grade of
// evidence behind it. Nothing may be read out of this file as a product fact
// without also reading its grade. An APPROXIMATION_FOR_BLOCKOUT never
// silently becomes a production fact — `assertProductionReady()` at the
// bottom exists to make that a build-time-visible rule rather than a
// convention people remember.
//
// Source imagery lives in clients/Arcubed_Label/03_Images/. IMPORTANT: every
// frame in that set is stored rotated 90° from upright — the bags are shot
// against a wall with "up" pointing to the right of frame. This is confirmed
// by DSC05765, where Loco's fringe (which can only hang downward under
// gravity) points to the left of frame. All proportions below are therefore
// taken with the image axes swapped: on-disk vertical extent = real width,
// on-disk horizontal extent = real height.

export type EvidenceGrade =
  | "CONFIRMED_FROM_PHOTOS"
  | "CONFIRMED_FROM_VIDEO"
  | "CONFIRMED_BY_RAND"
  | "APPROXIMATION_FOR_BLOCKOUT"
  | "UNRESOLVED";

export const EVIDENCE_LABEL: Record<EvidenceGrade, string> = {
  CONFIRMED_FROM_PHOTOS: "CONFIRMED FROM PHOTOS",
  CONFIRMED_FROM_VIDEO: "CONFIRMED FROM VIDEO",
  CONFIRMED_BY_RAND: "CONFIRMED BY RAND",
  APPROXIMATION_FOR_BLOCKOUT: "APPROXIMATION FOR BLOCKOUT",
  UNRESOLVED: "UNRESOLVED",
};

/** Grades that may never ship in a production asset without being re-graded. */
export const NON_PRODUCTION_GRADES: EvidenceGrade[] = [
  "APPROXIMATION_FOR_BLOCKOUT",
  "UNRESOLVED",
];

export interface Measured<T = number> {
  value: T;
  grade: EvidenceGrade;
  /** Which frame(s) or statement this came from. */
  source: string;
  note?: string;
}

export type HandleStyle =
  /** A tube rising clear of the body rim, open space beneath (Mini Luna). */
  | "arch"
  /** A hand-slot cut into a raised top band; the band either side is the grip (Vault, Loco). */
  | "slot-in-band"
  | "none";

export interface BlockoutSpec {
  key: "nova" | "vault" | "mini-luna" | "loco";
  label: string;
  /** Frames this blockout was traced from, and whether that attribution is itself confirmed. */
  frames: Measured<string[]>;

  // --- body silhouette, all proportions relative to body width = 1.0 ---
  /** Width of the body at its top edge, relative to overall body width. */
  topWidth: Measured;
  /** Width of the body at its base, relative to overall body width. */
  bottomWidth: Measured;
  /** Body height relative to body width. THIS is the proportion row. */
  heightRatio: Measured;
  /** Corner rounding at the top edge, relative to body width. */
  topCorner: Measured;
  /** Corner rounding at the base, relative to body width. */
  bottomCorner: Measured;
  /** Front-to-back depth relative to body width. Never visible in a frontal frame. */
  depthRatio: Measured;

  // --- handle ---
  handle: {
    present: Measured<boolean>;
    style: Measured<HandleStyle>;
    /** slot-in-band only: height of the raised band, relative to body width. */
    bandHeight: Measured;
    /** slot-in-band only: width of the cut slot, relative to body width. */
    slotWidth: Measured;
    /** Rise of the arch above the body top edge, relative to body width. */
    rise: Measured;
    /** Distance between the two attachment points, relative to body width. */
    span: Measured;
    /** Radius of the handle's cross-section, relative to body width. */
    thickness: Measured;
  };

  /** Loco only — the fringe zone is indicated, never modeled. */
  fringe?: {
    /** Fraction of total silhouette height occupied by hanging fringe. */
    lengthRatio: Measured;
    strandCount: Measured<null>;
    spacing: Measured<null>;
    attachment: Measured<null>;
  };
}

// ---------------------------------------------------------------------------

const TRACED = "traced from the frame listed in `frames`; pixel-level tracing of a single near-frontal shot, not a measurement of the physical bag";

export const VAULT: BlockoutSpec = {
  key: "vault",
  label: "Vault",
  frames: {
    value: ["DSC04876 (dark brown)", "DSC05790 (mid brown)"],
    grade: "CONFIRMED_BY_RAND",
    source: "round-3 archive audit named DSC04876 as Vault; DSC05790 shows the same construction in another colourway",
  },
  topWidth: { value: 1.0, grade: "CONFIRMED_FROM_PHOTOS", source: "DSC04876/DSC05790 — body is at its widest at the top edge" },
  bottomWidth: { value: 0.9, grade: "APPROXIMATION_FOR_BLOCKOUT", source: TRACED, note: "body narrows slightly toward the base; the exact taper is a trace, not a measurement" },
  heightRatio: {
    value: 0.53,
    grade: "CONFIRMED_FROM_PHOTOS",
    source: "measured by scripts/measure-products.mjs on orientation-normalized frames (lib-mask.mjs background-model mask); see .blockouts/measurements.json. Body excluding the top band/opening, across the three near-front frames: DSC05788 = 1.92, DSC05790 = 1.77, DSC05792 = 1.89. Median 1.89 : 1 wide (heightRatio 0.53)",
    note: "RESOLVED against the round-3 summary, which recorded Vault as 'taller-than-wide / boxy'. That came from un-normalized frames. Vault is decisively WIDER THAN TALL — three colourways, three frames, consistent to within 8%. Only near-front frames were used; the three-quarter frames (DSC04876/04877/04878) are foreshortened and were NOT averaged in.",
  },
  topCorner: { value: 0.16, grade: "APPROXIMATION_FOR_BLOCKOUT", source: TRACED },
  bottomCorner: { value: 0.3, grade: "APPROXIMATION_FOR_BLOCKOUT", source: TRACED, note: "base corners are visibly much softer than the top corners" },
  depthRatio: { value: 0.34, grade: "APPROXIMATION_FOR_BLOCKOUT", source: "DSC04877 and DSC04878 are three-quarter views that DO show Vault has substantial depth and a rounded back — an earlier note claiming no side view exists was wrong. They constrain depth qualitatively but yield no ratio without a known camera angle", note: "Still not a measurement. Do not promote to production." },
  handle: {
    present: { value: true, grade: "CONFIRMED_FROM_PHOTOS", source: "through-opening measured in DSC05788, DSC05790 and DSC05792" },
    style: {
      value: "slot-in-band",
      grade: "CONFIRMED_FROM_PHOTOS",
      source: "DSC05788/05790/05792 at full resolution: a thick rolled crochet band runs along the top and rises into a shallow arc with a THROUGH-opening beneath it. Measured opening area 1.6-2.3% of the object box, bottom edge at 18-20% of total height",
      note: "Distinguished from Mini Luna by measurement, not adjective: Mini Luna's opening is 7.0-11.6% of its box (4-5x larger) with its bottom at 43-46% of height. Vault's is a tight grip slot in a raised band. Two earlier passes each got this wrong in opposite directions, both from un-normalized frames.",
    },
    bandHeight: { value: 0.19, grade: "CONFIRMED_FROM_PHOTOS", source: "measured by scripts/measure-products.mjs on orientation-normalized frames (lib-mask.mjs background-model mask); see .blockouts/measurements.json. Opening bottom edge at 18/20/19% of total height across DSC05788/05790/05792" },
    slotWidth: { value: 0.30, grade: "APPROXIMATION_FOR_BLOCKOUT", source: "derived from the measured opening area (1.6-2.3% of box); the aperture profile is not resolvable at probe resolution" },
    rise: { value: 0, grade: "CONFIRMED_FROM_PHOTOS", source: "nothing rises clear of the body — the grip is the band itself" },
    span: { value: 0.42, grade: "APPROXIMATION_FOR_BLOCKOUT", source: TRACED },
    thickness: { value: 0.045, grade: "APPROXIMATION_FOR_BLOCKOUT", source: TRACED },
  },
};

export const MINI_LUNA: BlockoutSpec = {
  key: "mini-luna",
  label: "Mini Luna",
  frames: {
    value: ["DSC05774 + DSC05775 (red)", "DSC04870 (silver & gold)", "DSC04871", "DSC04872 (black)", "DSC04873", "DSC04874 (gold)", "DSC04875 (silver)"],
    grade: "CONFIRMED_FROM_PHOTOS",
    source: "DSC05774 is client-confirmed. DSC04870-04875 are attributed on two independent grounds: identical silhouette and opening geometry to the confirmed frame, AND a colour set (red, silver & gold, black, gold, silver) matching Mini Luna's confirmed colourway list exactly. This also settles the old 'Nova with Handle' ambiguity — these are Mini Luna; the genuine handled-Nova frames are DSC05776/05777",
  },
  topWidth: { value: 1.0, grade: "CONFIRMED_FROM_PHOTOS", source: "DSC05774" },
  bottomWidth: { value: 0.8, grade: "APPROXIMATION_FOR_BLOCKOUT", source: TRACED },
  heightRatio: { value: 0.44, grade: "CONFIRMED_FROM_PHOTOS", source: "measured by scripts/measure-products.mjs on orientation-normalized frames (lib-mask.mjs background-model mask); see .blockouts/measurements.json. Body excluding the arch: DSC04870 = 2.62, DSC04874 = 2.34, DSC04875 = 2.48, DSC05774 = 1.98, DSC05775 = 1.88. Median 2.34 : 1 wide. Spread is camera angle, not product variation" },
  topCorner: { value: 0.1, grade: "APPROXIMATION_FOR_BLOCKOUT", source: TRACED },
  bottomCorner: { value: 0.44, grade: "CONFIRMED_FROM_PHOTOS", source: "DSC05774 — the base is strongly rounded, close to a half-round" },
  depthRatio: {
    value: 0.36,
    grade: "APPROXIMATION_FOR_BLOCKOUT",
    source: "derived by scripts/measure-rim-aperture.mjs. The rim aperture is a planar ellipse, so its short axis projects foreshortened by sin(camera tilt) while its long axis does not. DSC05774 and DSC05775 are the only two frames whose darkest connected region is the bag interior rather than the contact shadow; solving them simultaneously (same bag depth seen at two tilts) pins tilt and depth together at 0.334-0.381 across a sweep of the one constant read by eye (the rolled rim wall, 0.10-0.18 W). Midpoint 0.358",
    note: "NO LONGER UNRESOLVED, but still NOT a measurement: two frames, an uncalibrated camera, and a wall thickness estimated by eye. Promote to CONFIRMED only on a measured side elevation or a tape measurement from Rand. The same solve independently recovers the untilted body at 2.37-2.55 : 1 wide, against the 2.34 : 1 that heightRatio measures by a completely different route (per-frame silhouette medians) — two methods agreeing within 5% is the reason this is trusted as far as it is.",
  },
  handle: {
    present: { value: true, grade: "CONFIRMED_FROM_PHOTOS", source: "DSC05774 — a large, thick, round arched handle, visually comparable in size to the body itself" },
    style: {
      value: "arch",
      grade: "CONFIRMED_FROM_PHOTOS",
      source: "DSC05774 at full resolution — a thick tube rising well clear of the body rim with open space beneath it. Structurally unlike Vault's and Loco's cut slots",
    },
    bandHeight: { value: 0, grade: "CONFIRMED_FROM_PHOTOS", source: "no raised band — the arch springs from the rim" },
    slotWidth: { value: 0, grade: "CONFIRMED_FROM_PHOTOS", source: "n/a for an arch" },
    rise: { value: 0.42, grade: "CONFIRMED_FROM_PHOTOS", source: "measured by scripts/measure-products.mjs on orientation-normalized frames (lib-mask.mjs background-model mask); see .blockouts/measurements.json. Opening bottom edge at 43/43/43/45/46% of total height across five frames and four colourways — the tightest measurement on any Arcubed product" },
    span: { value: 0.46, grade: "APPROXIMATION_FOR_BLOCKOUT", source: TRACED },
    thickness: { value: 0.085, grade: "CONFIRMED_FROM_PHOTOS", source: "DSC05774 — markedly thicker in cross-section than Vault's handle; this is a product-distinguishing feature, not a modelling choice" },
  },
};

export const LOCO: BlockoutSpec = {
  key: "loco",
  label: "Loco",
  frames: {
    value: ["DSC05765 (brown)"],
    grade: "CONFIRMED_BY_RAND",
    source: "round-3 archive audit named DSC05765 as Loco",
  },
  topWidth: { value: 1.0, grade: "CONFIRMED_FROM_PHOTOS", source: "DSC05765" },
  bottomWidth: { value: 0.96, grade: "APPROXIMATION_FOR_BLOCKOUT", source: TRACED, note: "the structured section's lower edge is obscured by fringe in every reviewed frame" },
  heightRatio: { value: 0.34, grade: "CONFIRMED_FROM_PHOTOS", source: "measured by scripts/measure-products.mjs on orientation-normalized frames (lib-mask.mjs background-model mask); see .blockouts/measurements.json. Whole object 1.60-1.63 : 1 across DSC05764/05765/05766; fringe begins at 55% of total height, so the structured band is 0.55 x (1/1.61) = 0.34 of body width. STRUCTURED BAND ONLY" },
  topCorner: { value: 0.12, grade: "APPROXIMATION_FOR_BLOCKOUT", source: TRACED },
  bottomCorner: { value: 0.2, grade: "UNRESOLVED", source: "the body's lower edge and base are behind the fringe in every reviewed frame" },
  depthRatio: { value: 0.3, grade: "UNRESOLVED", source: "no side or top view of Loco in the reviewed set" },
  handle: {
    present: { value: true, grade: "CONFIRMED_FROM_PHOTOS", source: "DSC05765" },
    style: {
      value: "slot-in-band",
      grade: "CONFIRMED_FROM_PHOTOS",
      source: "DSC05765 at full resolution — the same construction as Vault: a raised top band with a horizontal hand-slot cut through it",
      note: "Same KIND of opening as Vault. The bodies remain entirely different — Loco's fringe and shallower band are nothing like Vault's deep boxy body. Sharing an opening type is not permission to share geometry.",
    },
    bandHeight: { value: 0.21, grade: "CONFIRMED_FROM_PHOTOS", source: "measured by scripts/measure-products.mjs on orientation-normalized frames (lib-mask.mjs background-model mask); see .blockouts/measurements.json. Opening bottom edge at 21% of total height across DSC05764/05765/05766" },
    slotWidth: { value: 0.28, grade: "APPROXIMATION_FOR_BLOCKOUT", source: "derived from measured opening area 1.6% of box; profile not resolvable at probe resolution" },
    rise: { value: 0, grade: "CONFIRMED_FROM_PHOTOS", source: "nothing rises clear of the body" },
    span: { value: 0.34, grade: "APPROXIMATION_FOR_BLOCKOUT", source: TRACED },
    thickness: { value: 0.05, grade: "APPROXIMATION_FOR_BLOCKOUT", source: TRACED },
  },
  fringe: {
    lengthRatio: {
      value: 0.45,
      grade: "CONFIRMED_FROM_PHOTOS",
      source: "measured by scripts/measure-products.mjs on orientation-normalized frames (lib-mask.mjs background-model mask); see .blockouts/measurements.json. Fringe (rows fragmenting into many narrow runs at full probe resolution) begins at 55% of total height in all 6 Loco frames, so occupies the lower 45%. Up to 26 discrete strand runs counted on one row, which establishes the fringe IS many separate strands rather than a solid skirt",
      note: "This is an ENVELOPE proportion for indication only. It is not permission to model strands.",
    },
    strandCount: { value: null, grade: "UNRESOLVED", source: "not countable in any reviewed frame", note: "PROHIBITED from being invented." },
    spacing: { value: null, grade: "UNRESOLVED", source: "not measurable in any reviewed frame", note: "PROHIBITED from being invented." },
    attachment: { value: null, grade: "UNRESOLVED", source: "not resolvable in any of the 6 stills. NO VIDEO EXISTS LOCALLY — the archive video folders were never downloaded into this project, so the 'check the video first' routing cannot be executed here", note: "PROHIBITED from being invented. This is the single blocking unknown for Loco." },
  },
};

export const NOVA: BlockoutSpec = {
  key: "nova",
  label: "Nova",
  frames: {
    value: ["DSC04868 (silver, candidate)", "DSC05780 (black, candidate)"],
    grade: "UNRESOLVED",
    source: "the round-3 audit named 'Gold Nova photography' without file numbers. These two frames show a handle-less compact rounded metallic bag consistent with Nova, but the attribution is INFERRED FROM SHAPE AND COLOUR, not confirmed",
    note: "Confirm which files are Nova before any of Nova's numbers are promoted.",
  },
  topWidth: { value: 0.95, grade: "APPROXIMATION_FOR_BLOCKOUT", source: TRACED },
  bottomWidth: { value: 0.86, grade: "APPROXIMATION_FOR_BLOCKOUT", source: TRACED },
  heightRatio: {
    value: 0.49,
    grade: "APPROXIMATION_FOR_BLOCKOUT",
    source: "measured by scripts/measure-products.mjs on orientation-normalized frames (lib-mask.mjs background-model mask); see .blockouts/measurements.json. Handle-less near-front frames: DSC05786 = 1.99, DSC04868 = 2.05, DSC05780 = 2.18. Median 2.05 : 1 wide",
    note: "Confirms the round-1 'low, wide' reading that round 2 wrongly downgraded. Held at APPROXIMATION only because frame attribution to Nova is inferred from shape family, not client-confirmed.",
  },
  topCorner: { value: 0.28, grade: "APPROXIMATION_FOR_BLOCKOUT", source: TRACED },
  bottomCorner: { value: 0.42, grade: "APPROXIMATION_FOR_BLOCKOUT", source: TRACED },
  depthRatio: { value: 0.28, grade: "UNRESOLVED", source: "no side or top view in the reviewed set" },
  handle: {
    present: {
      value: false,
      grade: "UNRESOLVED",
      source: "BOTH configurations exist: DSC05776 and DSC05777 (gold) show a Nova-family pouch WITH a rolled top-band handle and a measured through-opening (2.3% / 1.2% of box, bottom at 24-25% of height); DSC05780, DSC04868 and DSC05786 show the same body with no handle and no through-opening at all",
      note: "CORRECTION: an earlier pass claimed 22 frames show no handle. That was wrong — 2 of the 22 clearly show one. The evidence now proves the handle is NEITHER universal NOR absent, which is exactly what photography can establish and exactly where it stops. Whether the handled pieces are a variant, an option, or a separate line is a BUSINESS RULE only Rand can answer. The blockout stays body-only: committing either way would encode a guess. (DSC04870-04875 are NOT candidates — they are Mini Luna.)",
    },
    style: { value: "none", grade: "UNRESOLVED", source: "BOTH configurations exist in the archive — see handle.present. The blockout is body-only; 'none' here means no handle is BUILT, not that Nova has none" },
    bandHeight: { value: 0, grade: "UNRESOLVED", source: "n/a until the handle rule is answered" },
    slotWidth: { value: 0, grade: "UNRESOLVED", source: "n/a until the handle rule is answered" },
    rise: { value: 0, grade: "UNRESOLVED", source: "n/a until the handle rule is answered" },
    span: { value: 0, grade: "UNRESOLVED", source: "n/a until the handle rule is answered" },
    thickness: { value: 0, grade: "UNRESOLVED", source: "n/a until the handle rule is answered" },
  },
};

export const BLOCKOUTS: Record<BlockoutSpec["key"], BlockoutSpec> = {
  nova: NOVA,
  vault: VAULT,
  "mini-luna": MINI_LUNA,
  loco: LOCO,
};

export interface GradeAudit {
  field: string;
  grade: EvidenceGrade;
  source: string;
  note?: string;
}

/** Flattens a spec into an auditable list — powers the dev UI's evidence panel. */
export function auditSpec(spec: BlockoutSpec): GradeAudit[] {
  const rows: GradeAudit[] = [];
  const push = (field: string, m: Measured<unknown>) =>
    rows.push({ field, grade: m.grade, source: m.source, note: m.note });

  push("frames", spec.frames);
  push("topWidth", spec.topWidth);
  push("bottomWidth", spec.bottomWidth);
  push("heightRatio", spec.heightRatio);
  push("topCorner", spec.topCorner);
  push("bottomCorner", spec.bottomCorner);
  push("depthRatio", spec.depthRatio);
  push("handle.present", spec.handle.present);
  push("handle.style", spec.handle.style);
  push("handle.bandHeight", spec.handle.bandHeight);
  push("handle.slotWidth", spec.handle.slotWidth);
  push("handle.rise", spec.handle.rise);
  push("handle.span", spec.handle.span);
  push("handle.thickness", spec.handle.thickness);
  if (spec.fringe) {
    push("fringe.lengthRatio", spec.fringe.lengthRatio);
    push("fringe.strandCount", spec.fringe.strandCount);
    push("fringe.spacing", spec.fringe.spacing);
    push("fringe.attachment", spec.fringe.attachment);
  }
  return rows;
}

/**
 * Every field that would block this spec from becoming production geometry.
 * A blockout is production-ready only when this returns an empty array —
 * which today it does for none of the four.
 */
export function productionBlockers(spec: BlockoutSpec): GradeAudit[] {
  return auditSpec(spec).filter((r) => NON_PRODUCTION_GRADES.includes(r.grade));
}
