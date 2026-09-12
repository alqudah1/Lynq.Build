/**
 * The verified colourway wall — one entry per product/colour pairing that has
 * its own real photography in src/lib/media-manifest.ts. Nothing here is a
 * guess: if a pairing has no frames, it does not appear.
 *
 * Shared by the homepage collection and the Shop so the two can never drift
 * apart on which colourways exist or what field each one sits on.
 *
 * FIELDS are the brand pink. Every one of them.
 *
 * They used to be sixteen individually art-directed colours — #8fa5b8,
 * #8d9b7a, #d9d3cc, #c07f5f, #b8a0c0, #e3c98a and so on: blue-greys, olives,
 * terracottas, mauves and tans. They were chosen carefully against each bag
 * and they were still wrong, because this is the largest surface on the site
 * and none of those colours are Arcubed's. The palette is navy, pale pink and
 * white; product photography is allowed to introduce gold, silver, red, olive
 * and burgundy, and several of those fields were exactly the beige the brand
 * is defined against. Stacked full-width on a phone the Shop read as a column
 * of unrelated coloured panels rather than as one label's collection.
 *
 * On one pink field the only colour in the wall is the PRODUCT, which is the
 * point of a colourway grid, and the tiles now match the photographic swatches
 * on the product pages, which have always sat on pink. Navy is still not an
 * option here: the cut-outs carry a soft studio matte that reads as a glow on
 * a dark ground.
 *
 * Kept as a per-entry field rather than hardcoded in the components so a
 * future art direction can vary it again deliberately.
 */
export interface CollectionEntry {
  slug: string;
  product: string;
  colour: string;
  field: string;
  /** Force the full photograph instead of a cut-out. */
  forcePhoto?: true;
}

export const COLLECTION: CollectionEntry[] = [
  { slug: "nova", product: "Nova", colour: "Gold", field: "#ffe0fd" },
  { slug: "mini-luna", product: "Mini Luna", colour: "Red", field: "#ffe0fd" },
  { slug: "vault", product: "Vault", colour: "Olive Green", field: "#ffe0fd" },
  { slug: "nova", product: "Nova", colour: "Black", field: "#ffe0fd" },

  { slug: "mini-luna", product: "Mini Luna", colour: "Silver", field: "#ffe0fd" },
  // Full photograph: this matte traps a patch of seamless inside the hand slot
  // that is connected to the region running round the bag, so it cannot be
  // lifted as an enclosed patch, and the threshold that would catch it starts
  // erasing the silver bags. An honest photographic tile beats a white hole.
  { slug: "vault", product: "Vault", colour: "Brown", field: "#ffe0fd", forcePhoto: true },
  { slug: "nova", product: "Nova", colour: "Champagne", field: "#ffe0fd" },
  { slug: "loco", product: "Loco", colour: "Brown", field: "#ffe0fd" },

  { slug: "mini-luna", product: "Mini Luna", colour: "Gold", field: "#ffe0fd" },
  { slug: "nova", product: "Nova", colour: "Silver", field: "#ffe0fd" },
  { slug: "loco", product: "Loco", colour: "Burgundy", field: "#ffe0fd" },
  { slug: "vault", product: "Vault", colour: "Light Brown", field: "#ffe0fd" },

  { slug: "mini-luna", product: "Mini Luna", colour: "Black", field: "#ffe0fd" },
  { slug: "nova", product: "Nova", colour: "Rose Gold", field: "#ffe0fd" },
  { slug: "mini-luna", product: "Mini Luna", colour: "Silver & Gold", field: "#ffe0fd" },
  { slug: "nova", product: "Nova", colour: "Silver & Gold", field: "#ffe0fd" },
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
