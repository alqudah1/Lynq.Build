/**
 * The verified colourway wall — one entry per product/colour pairing that has
 * its own real photography in src/lib/media-manifest.ts. Nothing here is a
 * guess: if a pairing has no frames, it does not appear.
 *
 * Shared by the homepage collection and the Shop so the two can never drift
 * apart on which colourways exist or what field each one sits on.
 *
 * ---------------------------------------------------------------------------
 * DISPLAY FIELDS
 * ---------------------------------------------------------------------------
 * Third system. The first gave every tile its own mid-tone hue — #8fa5b8,
 * #8d9b7a, #d9d3cc, #c07f5f, #b8a0c0, #e3c98a — which had real variety but
 * included the tans and terracottas that read as the beige luxury palette the
 * brand is defined against. The correction put all sixteen on brand pink,
 * which was flat. The correction to THAT was four values so close together
 * (#eef1f7, #fff2fe, #f8f5f9) that the wall still read as one pale box
 * repeated sixteen times.
 *
 * These are deliberately deeper — roughly 85 to 90% lightness rather than 96
 * — so the difference between one tile and the next is actually visible at
 * arm's length, and every one is drawn from a family the brand allows:
 *
 *   PINK      #ffe0fd  the brand field
 *   BLUSH     #f6d8de  soft rose
 *   LAVENDER  #e4daf0  soft lavender
 *   SKY       #d6e2f0  powder blue
 *   MIST      #dae3ea  very pale grey-blue
 *   SAGE      #d6dfcd  muted olive, pale
 *   OLIVE     #c6d0b9  muted olive, deeper — for the palest objects
 *   SNOW      #f4f1f4  near-white, where any tint would fight the product
 *
 * No tans, no terracotta, no gold, no brown interface colour. Navy appears
 * only as a FRAME around a photograph, never behind a cut-out, because the
 * cut-outs carry a soft studio matte that glows on a dark ground.
 *
 * Assignment is per tile and by eye against the object, not algorithmic. The
 * rule behind each choice is contrast: a warm metallic goes on a cool ground,
 * a cool metallic on a warm one, a very pale object on the deepest field in
 * the set, and a red — which is muddy on pink and weak on white — on sage.
 * The second rule is that no two tiles SIDE BY SIDE in a row may share a
 * field; rows are set by SHOP_RHYTHM, so this list and that one have to be
 * read together.
 */
export interface CollectionEntry {
  slug: string;
  product: string;
  colour: string;
  field: string;
  /** Force the full photograph instead of a cut-out. */
  forcePhoto?: true;
  /**
   * Show the photograph INSET inside the field rather than bleeding to the
   * tile edge, so the image has a visible boundary and the field reads as a
   * mount around it.
   *
   * EVERY photograph is mounted and every cut-out floats on a field. That is
   * the whole rule, and it exists because the three photographic tiles carry
   * their own studio ground: measured, Loco Brown sits at 0.75 luminance and
   * Vault Brown at 0.85 against 0.92 to 0.94 for the clean frames. Bled to
   * the tile edge next to bags on brand colour, those grounds read as dirty
   * boxes. Given a margin they read as photographs someone chose to print.
   *
   * Loco Brown is mounted on navy because it is the darkest picture in the
   * archive and the only one that can hold it; the other two take pink and
   * blush.
   */
  framed?: true;
}

export const COLLECTION: CollectionEntry[] = [
  { slug: "nova", product: "Nova", colour: "Gold", field: "#d6e2f0" },
  { slug: "mini-luna", product: "Mini Luna", colour: "Red", field: "#d6dfcd" },
  { slug: "vault", product: "Vault", colour: "Olive Green", field: "#f6d8de" },
  { slug: "nova", product: "Nova", colour: "Black", field: "#e4daf0" },

  { slug: "mini-luna", product: "Mini Luna", colour: "Silver", field: "#ffe0fd" },
  // Full photograph: this matte traps a patch of seamless inside the hand slot
  // that is connected to the region running round the bag, so it cannot be
  // lifted as an enclosed patch, and the threshold that would catch it starts
  // erasing the silver bags. An honest photographic tile beats a white hole.
  { slug: "vault", product: "Vault", colour: "Brown", field: "#f6d8de", forcePhoto: true, framed: true },
  { slug: "nova", product: "Nova", colour: "Champagne", field: "#c6d0b9" },
  // Mini Luna sits here and Loco below deliberately. Frames are handed out by
  // shape WITHIN a row, so a bag can only ever get the best frame its own row
  // contains, and this row's narrowest is a 6/5. Loco is a photograph, which a
  // narrow frame crops rather than shrinks; Mini Luna is the one shape in the
  // catalogue that fits a 6/5 almost exactly. Swapping the two moves Loco into
  // the 3/2 row below, where it loses two percent of its width instead of
  // eighteen, and costs Mini Luna nothing.
  { slug: "mini-luna", product: "Mini Luna", colour: "Gold", field: "#e4daf0" },

  { slug: "loco", product: "Loco", colour: "Brown", field: "#143562", framed: true },
  { slug: "nova", product: "Nova", colour: "Silver", field: "#f6d8de" },
  { slug: "loco", product: "Loco", colour: "Burgundy", field: "#ffe0fd", framed: true },
  { slug: "vault", product: "Vault", colour: "Light Brown", field: "#d6e2f0" },

  { slug: "mini-luna", product: "Mini Luna", colour: "Black", field: "#f6d8de" },
  { slug: "nova", product: "Nova", colour: "Rose Gold", field: "#dae3ea" },
  { slug: "mini-luna", product: "Mini Luna", colour: "Silver & Gold", field: "#e4daf0" },
  { slug: "nova", product: "Nova", colour: "Silver & Gold", field: "#d6dfcd" },
];

/**
 * PER-COLOURWAY FIT.
 *
 * `s` is the last correction in a chain, and deliberately the smallest one.
 * The first version of this map was derived from each asset's transparent
 * margin, which turned out to be the wrong variable: measured on the rendered
 * page it barely moved anything, and the wall still ran from 0.20 to 0.59 of
 * tile area — Nova Champagne carrying a third of Mini Luna Red's weight.
 *
 * What actually drove it was the FRAME. Sizing is shared (76% of tile width,
 * contain), so a wide bag in a tall frame is width-bound and reaches only a
 * fraction of the tile's height. Fixing SHOP_RHYTHM to the catalogue's real
 * aspect range, and handing each row's frames out by shape rather than by
 * catalogue position, moved the spread to 0.29 - 0.59 on its own and took
 * Champagne from 0.20 to 0.45 with no scaling at all. Widening row 3 did the
 * rest, because a photograph in a frame narrower than itself loses content:
 * both Loco tiles were cropping to a band of fringe with no bag in them.
 *
 * `s` closes the residual. Each value is measured off the live tile and
 * corrected towards a 0.38 target area, at 75% strength rather than 100%:
 * a full equalisation flattens the feature frames, which SHOULD carry a
 * little more weight than the small ones. Re-derive with a script, not by
 * eye, and re-derive whenever SHOP_RHYTHM moves: every number here is
 * measured against the frames above and means nothing without them.
 *
 * `tx` and `ty` are separate, and fix a different measured problem: several
 * cut-outs are not centred inside their own asset. Mini Luna Silver & Gold
 * sits at 41.5% across, Vault Light Brown at 56.9%, Mini Luna Black at 63.5%
 * DOWN. Each value is (50 - measured centre), as a percentage of the image
 * box, so the object lands on the tile's centre instead of the file's.
 *
 * Loco and Vault Brown are absent on purpose: they render as full
 * photographs, where the frame is the crop and there is no object to fit.
 */
export interface ColourFit {
  /** Scale about the centre. 1 = current behaviour. */
  s: number;
  /** Percent of the image box, correcting an off-centre object. */
  tx?: number;
  ty?: number;
}

export const COLOUR_FIT: Record<string, ColourFit> = {
  // Nova. The two feature frames come DOWN now, not up: a 2/1 frame gives a
  // wide bag room it never had in a square, and Black and Rose Gold were the
  // heaviest tiles on the page once the frames were fixed.
  "nova|Gold": { s: 1.135, tx: -2.5, ty: 2.2 },
  "nova|Black": { s: 0.958, tx: -2.9, ty: 1.2 },
  "nova|Champagne": { s: 0.992, tx: -1.6, ty: 7.0 },
  "nova|Silver": { s: 1.081, tx: 3.0, ty: 0.4 },
  "nova|Rose Gold": { s: 0.948, tx: 2.3, ty: 1.2 },
  "nova|Silver & Gold": { s: 0.937, tx: 0.5, ty: 0.4 },
  // Mini Luna. Black is the exception in the family: its cut-out carries a
  // deep empty band, so it needs the largest correction UP while its
  // siblings come slightly down.
  "mini-luna|Red": { s: 0.92, tx: -4.3, ty: 1.5 },
  "mini-luna|Silver": { s: 0.951, tx: 6.7, ty: 0.4 },
  "mini-luna|Gold": { s: 0.971, tx: 5.3, ty: 0.2 },
  "mini-luna|Black": { s: 1.089, tx: 2.2, ty: -13.5 },
  "mini-luna|Silver & Gold": { s: 0.983, tx: 8.5, ty: 0.5 },
  // Vault: sits on the target already, so these barely move.
  "vault|Olive Green": { s: 1.034, tx: -5.5, ty: 0.8 },
  "vault|Light Brown": { s: 1.017, tx: -6.9, ty: 1.0 },
};

export function colourFit(slug: string, colour: string): ColourFit | undefined {
  return COLOUR_FIT[`${slug}|${colour}`];
}

/**
 * WHICH COLOURWAY A MODEL BLOCK OPENS ON.
 *
 * Catalogue order decides this for Nova, Mini Luna and Vault, and it should:
 * the block then leads with the same colourway the wall does.
 *
 * Loco is overridden, and the reason is measurable rather than preferred. All
 * four Brown frames were shot on a noticeably darker seamless than the rest
 * of the archive: mean ground luminance 0.75, RGB around 194,192,188, a mid
 * GREY. Every other product in the collection sits on 0.92 to 0.94, RGB
 * around 240. Beside Vault on brand pink, the Loco block was the one tile on
 * the page with a dirty grey ground, which is what the client saw and called
 * out as not being as nice as the others.
 *
 * The Burgundy frames were shot on the clean seamless: ground 0.936, RGB
 * 240,238,236, in line with everything else. So the block opens on Burgundy.
 * Brown is not hidden — it is the second swatch, one tap away, and it still
 * leads the Shop wall and the shop opener where it sits on its own.
 *
 * No retouching: nobody has relit or colour-corrected the client's
 * photography to force a match.
 */
export const LEAD_COLOUR: Record<string, string> = {
  loco: "Burgundy",
};

/**
 * FRAMES SIZED TO THE CATALOGUE.
 *
 * The first rhythm was composed as abstract proportion — squares, a 3/4
 * upright, a 6/5 — and every one of those frames is TALLER than any bag
 * Arcubed makes. Measured across the sixteen assets the shapes run 1.16
 * (Mini Luna) to 2.08 (Nova), so a wide bag in a square frame either shrinks
 * to fit the width (cut-outs, which is how Nova Champagne ended up at a fifth
 * of its tile) or gets its sides cropped away (photographs, which is how both
 * Loco tiles came to show fringe and no bag).
 *
 * Every frame here now sits between 1.0 and 2.0, inside the range the product
 * actually occupies. Rows still sum to twelve columns and still resolve to one
 * height each, so the wall stays flat; the rhythm now comes from the row
 * heights (3, 3.5, 3, 4 column-units) rather than from frames the product
 * cannot fill.
 */
export const SHOP_RHYTHM: { span: number; ratio: string; feature?: true }[] = [
  // Row 1 — three landscape frames, 2.8 units tall.
  { span: 4, ratio: "10 / 7" },
  { span: 4, ratio: "10 / 7" },
  { span: 4, ratio: "10 / 7" },
  // Row 2 — a cinematic feature beside a wide frame. Both 3.5 units.
  { span: 7, ratio: "2 / 1", feature: true },
  { span: 5, ratio: "10 / 7" },
  // Row 3 — three widths, 2.5 units, the shortest row in the cycle. It has to
  // be: this is the row the two photographic tiles land in, and a photograph
  // is CROPPED by a frame narrower than itself rather than just reduced. At
  // three units the narrowest frame here was a square, which cut both Loco
  // bags down to a band of fringe with no bag left in the tile.
  { span: 5, ratio: "2 / 1" },
  { span: 4, ratio: "8 / 5" },
  { span: 3, ratio: "6 / 5" },
  // Row 4 — two large frames, 4 units, the tallest moment in the cycle.
  { span: 6, ratio: "3 / 2" },
  { span: 6, ratio: "3 / 2" },
];
