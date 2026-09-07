/**
 * The verified colourway wall — one entry per product/colour pairing that has
 * its own real photography in src/lib/media-manifest.ts. Nothing here is a
 * guess: if a pairing has no frames, it does not appear.
 *
 * Shared by the homepage collection and the Shop so the two can never drift
 * apart on which colourways exist or what field each one sits on.
 *
 * FIELDS are art-directed as a whole, not chosen per tile: each row alternates
 * warm and cool, neighbours never share a hue family in either direction, and
 * every field is picked against its own bag (cool grounds under the golds,
 * warm grounds under the silvers and blacks). They are all light to mid tone —
 * the cut-outs carry a soft studio matte that reads as a glow on a dark
 * ground, which is why nothing here sits on navy.
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
  { slug: "nova", product: "Nova", colour: "Gold", field: "#8fa5b8" },
  { slug: "mini-luna", product: "Mini Luna", colour: "Red", field: "#8d9b7a" },
  { slug: "vault", product: "Vault", colour: "Olive Green", field: "#d9d3cc" },
  { slug: "nova", product: "Nova", colour: "Black", field: "#d6b06a" },

  { slug: "mini-luna", product: "Mini Luna", colour: "Silver", field: "#c07f5f" },
  // Full photograph: this matte traps a patch of seamless inside the hand slot
  // that is connected to the region running round the bag, so it cannot be
  // lifted as an enclosed patch, and the threshold that would catch it starts
  // erasing the silver bags. An honest photographic tile beats a white hole.
  { slug: "vault", product: "Vault", colour: "Brown", field: "#7e93a8", forcePhoto: true },
  { slug: "nova", product: "Nova", colour: "Champagne", field: "#b8a0c0" },
  { slug: "loco", product: "Loco", colour: "Brown", field: "#c9b8a4" },

  { slug: "mini-luna", product: "Mini Luna", colour: "Gold", field: "#6f8496" },
  { slug: "nova", product: "Nova", colour: "Silver", field: "#a8747c" },
  { slug: "loco", product: "Loco", colour: "Burgundy", field: "#bfae9a" },
  { slug: "vault", product: "Vault", colour: "Light Brown", field: "#a9b89a" },

  { slug: "mini-luna", product: "Mini Luna", colour: "Black", field: "#e3c98a" },
  { slug: "nova", product: "Nova", colour: "Rose Gold", field: "#7e8f6f" },
  { slug: "mini-luna", product: "Mini Luna", colour: "Silver & Gold", field: "#d89a7a" },
  { slug: "nova", product: "Nova", colour: "Silver & Gold", field: "#96a8bd" },
];

/**
 * Frame rhythm for the Shop, on a 12-column grid. Eight entries covering three
 * rows (4+4+4, 7+5, 5+3+4), so sixteen colourways lay out as two complete
 * cycles with no orphan row. A catalogue rhythm, not masonry: the sequence is
 * fixed, so the page composes the same way every time.
 */
export const SHOP_RHYTHM: { span: number; ratio: string; feature?: true }[] = [
  { span: 4, ratio: "1 / 1" },
  { span: 4, ratio: "4 / 5" },
  { span: 4, ratio: "1 / 1" },
  // The wide feature is paired with a SQUARE, not a portrait: at 7 columns and
  // 16:10 it is 4.4 column-units tall, and a 5-column portrait beside it is
  // 6.25 — a 40% mismatch that left a void under the feature.
  { span: 7, ratio: "16 / 10", feature: true },
  { span: 5, ratio: "1 / 1" },
  { span: 5, ratio: "4 / 5" },
  { span: 3, ratio: "1 / 1" },
  { span: 4, ratio: "3 / 4" },
];
