/**
 * The verified colourway wall — one entry per product/colour pairing that has
 * its own real photography in src/lib/media-manifest.ts. Nothing here is a
 * guess: if a pairing has no frames, it does not appear.
 *
 * Shared by the homepage collection and the Shop so the two can never drift
 * apart on which colourways exist or what field each one sits on.
 *
 * FIELDS are a CONTROLLED four-value system, assigned per product for
 * contrast. Not one flat colour, and not the sixteen hand-picked hues before
 * that.
 *
 * The first version of this file gave every tile its own colour — #8fa5b8,
 * #8d9b7a, #d9d3cc, #c07f5f, #b8a0c0, #e3c98a and so on. Blue-greys, olives,
 * terracottas, tans. Off-palette, and several of them the beige the brand is
 * defined against. The correction was to put all sixteen on the brand pink,
 * which fixed the palette and introduced a new problem: sixteen identical
 * pink boxes read as flat and repetitive, and pink under a red or a burgundy
 * bag is nearly the same hue, so the product stopped separating from its own
 * ground.
 *
 * Four values, all navy/pink/white derived, chosen so the BAG looks good:
 *
 *   PINK   #ffe0fd  the brand field. Under dark objects — black, olive,
 *                   dark brown — where it gives the most separation.
 *   BLUSH  #fff2fe  pink at a quarter strength. A warm ground under the cool
 *                   metallics, silver and silver & gold.
 *   MIST   #eef1f7  navy at 6%. A cool ground under the warm metallics, gold,
 *                   champagne and rose gold, which is where a pink field went
 *                   muddy and a warm field disappeared.
 *   SNOW   #f8f5f9  near-white with a pink cast. For reds and burgundies,
 *                   which sit too close to pink in hue to separate from it,
 *                   and still reads as a tile against the white page.
 *
 * Navy is not in the set: the cut-outs carry a soft studio matte that reads as
 * a glow on a dark ground. No beige, no third hue family, nothing outside
 * navy/pink/white. */
export interface CollectionEntry {
  slug: string;
  product: string;
  colour: string;
  field: string;
  /** Force the full photograph instead of a cut-out. */
  forcePhoto?: true;
}

export const COLLECTION: CollectionEntry[] = [
  { slug: "nova", product: "Nova", colour: "Gold", field: "#eef1f7" },
  { slug: "mini-luna", product: "Mini Luna", colour: "Red", field: "#f8f5f9" },
  { slug: "vault", product: "Vault", colour: "Olive Green", field: "#ffe0fd" },
  { slug: "nova", product: "Nova", colour: "Black", field: "#ffe0fd" },

  { slug: "mini-luna", product: "Mini Luna", colour: "Silver", field: "#fff2fe" },
  // Full photograph: this matte traps a patch of seamless inside the hand slot
  // that is connected to the region running round the bag, so it cannot be
  // lifted as an enclosed patch, and the threshold that would catch it starts
  // erasing the silver bags. An honest photographic tile beats a white hole.
  { slug: "vault", product: "Vault", colour: "Brown", field: "#f8f5f9", forcePhoto: true },
  { slug: "nova", product: "Nova", colour: "Champagne", field: "#eef1f7" },
  { slug: "loco", product: "Loco", colour: "Brown", field: "#ffe0fd" },

  { slug: "mini-luna", product: "Mini Luna", colour: "Gold", field: "#eef1f7" },
  { slug: "nova", product: "Nova", colour: "Silver", field: "#fff2fe" },
  { slug: "loco", product: "Loco", colour: "Burgundy", field: "#f8f5f9" },
  { slug: "vault", product: "Vault", colour: "Light Brown", field: "#ffe0fd" },

  { slug: "mini-luna", product: "Mini Luna", colour: "Black", field: "#ffe0fd" },
  { slug: "nova", product: "Nova", colour: "Rose Gold", field: "#eef1f7" },
  { slug: "mini-luna", product: "Mini Luna", colour: "Silver & Gold", field: "#fff2fe" },
  { slug: "nova", product: "Nova", colour: "Silver & Gold", field: "#eef1f7" },
];

/**
 * Frame rhythm for the Shop, on a 12-column grid.
 *
 * Every row sums to 12 AND every tile in a row resolves to the same height,
 * because span and ratio are chosen together: a 7-wide at 8:5 and a 5-wide at
 * 8:7 are both 4.375 column-units tall. Heights then vary BETWEEN rows (4,
 * 4.375, 4, 5), which is where the rhythm comes from.
 *
 * The previous set matched row widths but not row heights, so short tiles
 * left dead white beneath them and the wall read as masonry rather than as a
 * composed catalogue.
 */
export const SHOP_RHYTHM: { span: number; ratio: string; feature?: true }[] = [
  // Row 1 — three squares, 4 column-units tall each.
  { span: 4, ratio: "1 / 1" },
  { span: 4, ratio: "1 / 1" },
  { span: 4, ratio: "1 / 1" },
  // Row 2 — a wide feature beside a near-square. Both 4.375 units tall.
  { span: 7, ratio: "8 / 5", feature: true },
  { span: 5, ratio: "8 / 7" },
  // Row 3 — three different widths, all 4 units tall, including a narrow
  // detail frame.
  { span: 5, ratio: "5 / 4" },
  { span: 3, ratio: "3 / 4" },
  { span: 4, ratio: "1 / 1" },
  // Row 4 — two large frames, 5 units tall.
  { span: 6, ratio: "6 / 5" },
  { span: 6, ratio: "6 / 5" },
];
