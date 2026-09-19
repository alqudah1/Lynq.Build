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
      // DSC04873 FIRST. The first frame of a colourway is its face
      // everywhere — Shop tile, model block, swatch, cart thumbnail — and
      // DSC04872 carries a matte flaw: a smear of studio ground trapped in
      // the arch. The homepage already refused it by name; the client found
      // it in the model block, cropped through the middle by a fit tuned to
      // its portrait shape ("the black Mini Luna preview ... is cropped
      // midway through"). 04872 stays in the product gallery as a second
      // view.
      "Black":         { frames: ["DSC04873", "DSC04872"] },
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

/**
 * FRAMES WHOSE **FRAMED PHOTOGRAPH** IS DRAWN LARGE, despite having a usable
 * cut-out.
 *
 * The default framed photo tops out at `-1600`, and that name is a target,
 * not a measurement: the crop comes out of the 1600px matte proxy, so what
 * lands on disk is whatever the object box occupies inside it. Measured
 * across the archive that is 1184 to 1552 pixels, never 1600.
 *
 * For a tile or a swatch that is plenty. For DSC05774 it was not: About draws
 * that photograph at 84vw, which is 1290 physical pixels on a DPR2 tablet
 * against a 1184px file — effective detail 0.88, the last under-resolved
 * image on the site and one no `sizes` change could fix, because the pixels
 * did not exist. Listing it here re-cuts the same region out of the 3200px
 * proxy instead, exactly the way the Loco photographs are already built.
 *
 * Add a frame here only when its FRAMED photo (not its cut-out, not its tile)
 * is rendered wider than about 40% of a large viewport. Everything else stays
 * at 1600 — building all 53 at 2600 added 68MB that nothing renders.
 */
export const HIRES_PHOTOS = new Set([
  "DSC05774", // Mini Luna Red — the About plate
]);

/**
 * FRAMES WHOSE **CUT-OUT** IS DRAWN LARGE.
 *
 * The cut-out pipeline composites an alpha matte onto RGB taken from the
 * 1600px matte proxy, because that is the resolution the matte is computed
 * at. Every `-cut-*` file therefore inherits the proxy's detail, and the
 * largest one is named `-cut-2600` — a name that describes its pixel count
 * and not its information. For DSC05792 the crop out of that proxy is 1452px
 * wide and the file is 2860px: a 1.97x enlargement, shipped as the largest
 * object on the homepage.
 *
 * That is what the client photographed as "visibly pixelated", and no audit
 * could have caught it, because 2860px of real header dimensions across
 * roughly 1500 physical pixels scores 1.28 — comfortably adequate, and
 * entirely interpolated.
 *
 * Listing a frame here rebuilds its `-cut-2600` with RGB taken from the
 * FULL-RESOLUTION original — the same crop rectangle, scaled up from probe
 * space to the 6000px frame, so the region has 5445 real pixels behind it
 * and 2600 is a downsample. The matte is still computed at probe resolution
 * and enlarged to suit, which costs nothing: it is a blurred edge mask with
 * no fine detail to lose, and the pixels a viewer looks at are the
 * photograph's.
 *
 * Add a frame only when its CUT-OUT is rendered large. The other cut-outs in
 * the archive are swatches and tiles at a few hundred pixels, where the proxy
 * is more resolution than they can show.
 */
export const HIRES_CUTS = new Set([
  "DSC05792", // Vault Olive Green — the "Made yours" campaign object
  "DSC05786", // Nova Gold — the homepage hero (and the Shop's Nova lead tile)
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
