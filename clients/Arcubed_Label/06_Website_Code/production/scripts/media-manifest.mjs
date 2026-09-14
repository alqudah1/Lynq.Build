// THE customer-facing media map: product + colourway -> real archive frames.
//
// Every assignment below is evidence-based, not eyeballed:
//   - product attribution from docs/3d-production/PRODUCT-GEOMETRY-MAP.md
//   - colourway from scripts/analyze-colourways.mjs, which samples OBJECT
//     pixels only (hue/saturation/luminance) so the lit backdrop can't skew it
//   - each grouping then confirmed visually against the catalogue colour list
//     read live from the database
//
// Two colourways are photographed but NOT purchasable, so they are recorded
// here and deliberately excluded from customer-facing colour lookups:
//   Nova hot pink  (DSC04860/61/62) — not in Nova's confirmed colour list
//   Vault blue-grey(DSC05788/89)    — not in Vault's confirmed colour list
// They may be used as editorial imagery ONLY where nothing implies they can
// be bought. Showing an unbuyable colourway as a product option would be a
// lie about the catalogue.

export const PRODUCT_MEDIA = {
  nova: {
    colours: {
      "Gold":          { frames: ["DSC05786", "DSC05787"], withHandle: ["DSC05776", "DSC05777"] },
      "Black":         { frames: ["DSC05780", "DSC05782", "DSC05783"] },
      "Champagne":     { frames: ["DSC05784", "DSC05785"] },
      "Silver":        { frames: ["DSC04868", "DSC04869"] },
      "Rose Gold":     { frames: ["DSC04863", "DSC04864", "DSC04865"] },
      "Silver & Gold": { frames: ["DSC04866", "DSC04867", "DSC05778", "DSC05779"] },
    },
    editorialOnly: { "Hot Pink (not sold)": ["DSC04860", "DSC04861", "DSC04862"] },
  },
  vault: {
    colours: {
      "Brown":       { frames: ["DSC04876", "DSC04877", "DSC04878"] },
      "Light Brown": { frames: ["DSC05790", "DSC05791"] },
      "Olive Green": { frames: ["DSC05792", "DSC05793"] },
    },
    editorialOnly: { "Blue-grey (not sold)": ["DSC05788", "DSC05789"] },
  },
  "mini-luna": {
    colours: {
      "Red":           { frames: ["DSC05774", "DSC05775"] },
      "Silver":        { frames: ["DSC04875"] },
      "Gold":          { frames: ["DSC04874"] },
      "Black":         { frames: ["DSC04872", "DSC04873"] },
      "Silver & Gold": { frames: ["DSC04870", "DSC04871"] },
    },
    editorialOnly: {},
  },
  loco: {
    colours: {
      // THREE FRAMES, NOT FOUR — and the two that left were not weak, they
      // were the SAME PICTURE. DSC05764, 05765 and 05766 are three exposures
      // of one setup: same camera position, same light, same bag angle, the
      // object box within about one percent across all three. Swiping the
      // gallery moved between them and nothing appeared to happen, which is
      // exactly what a customer reported. Only 05765 stays.
      //
      // 05770 earns its place because it is a genuinely different view: shot
      // from above and to the side, it is the only Loco frame that shows the
      // opening, the interior, and both handle bars at once.
      //
      // The third beat is a macro of the same object (see DETAIL_CROPS), so
      // the set reads whole bag, then how it opens, then how it is made.
      "Brown":    { frames: ["DSC05765", "DSC05770"] },
      // Left alone: 05772 is a clean front and 05773 is a three-quarter with
      // the handle sweep. Two frames, two views, no duplication to remove.
      "Burgundy": { frames: ["DSC05772", "DSC05773"] },
    },
    editorialOnly: {},
  },
};

/**
 * MACRO DETAIL FRAMES — a real crop of a real frame, joining that colourway's
 * own gallery as an extra view.
 *
 * This is not a new photograph and nothing is generated: it is a rectangle
 * taken out of the client's 6000x4000 original at full resolution, which is
 * the same thing TEXTURE_CROPS has always done for the editorial macros. It
 * exists because Loco Brown has only two genuinely distinct camera positions
 * in the archive, and a two-image gallery for the most texturally interesting
 * bag in the collection undersells it.
 *
 * `rel` is a fraction of the DETECTED OBJECT BOX, as everywhere else in this
 * file. The window deliberately keeps the left edge of the bag and a little
 * studio ground: a crop taken purely from the middle of the fringe reads as
 * an abstract brown rectangle (that is the note already recorded against
 * texture-fringe in build-textures.mjs). With the edge, the stitch rows and
 * the knot line in frame, it reads as a crocheted object.
 */
export const DETAIL_CROPS = [
  {
    id: "loco-brown-detail",
    slug: "loco",
    colour: "Brown",
    frame: "DSC05765",
    rel: { l: 0.08, t: 0.04, w: 0.52, h: 0.62 },
    alt: "Close detail of the Loco in Brown: crocheted stitch rows and the knotted top of the fringe",
  },
];

/**
 * Cut-outs rejected by visual QA — the UI must use the FRAMED photograph for
 * these instead of the transparent version.
 *
 * Loco's fringe is hundreds of separate strands with backdrop visible between
 * them. The matte correctly keeps those gaps transparent at the edges, but
 * retains lit-grey backdrop in the dense interior, which reads as a grey patch
 * on the pink field. Real photography beats a damaged cut-out, so Loco is
 * composed as a framed image everywhere.
 */
export const REJECTED_CUTOUTS = new Set([
  "DSC05765", "DSC05764", "DSC05766", "DSC05770", // Loco brown
  "DSC05772", "DSC05773",                          // Loco burgundy
]);

/** Macro texture crops, taken relative to the detected object box. */
export const TEXTURE_CROPS = [
  { id: "texture-fringe",   frame: "DSC05765", rel: { l: 0.04, t: 0.34, w: 0.40, h: 0.52 } },
  { id: "texture-metallic", frame: "DSC05774", rel: { l: 0.06, t: 0.44, w: 0.40, h: 0.34 } },
  { id: "texture-chunky",   frame: "DSC05790", rel: { l: 0.10, t: 0.30, w: 0.42, h: 0.36 } },
  { id: "texture-gold",     frame: "DSC05786", rel: { l: 0.14, t: 0.36, w: 0.38, h: 0.32 } },
  { id: "texture-twotone",  frame: "DSC04866", rel: { l: 0.16, t: 0.34, w: 0.40, h: 0.34 } },
];

/** slug -> every frame used, deduped. */
export function allFrames() {
  const set = new Set();
  for (const p of Object.values(PRODUCT_MEDIA)) {
    for (const c of Object.values(p.colours)) {
      for (const f of c.frames) set.add(f);
      for (const f of c.withHandle ?? []) set.add(f);
    }
    for (const list of Object.values(p.editorialOnly ?? {})) for (const f of list) set.add(f);
  }
  for (const t of TEXTURE_CROPS) set.add(t.frame);
  for (const d of DETAIL_CROPS) set.add(d.frame);
  return [...set].sort();
}
