// Maps each real Arcubed product to imported REAL photography.
//
// Every file referenced here is a crop/resize of an actual client frame from
// clients/Arcubed_Label/03_Images/, produced by scripts/import-product-media.mjs.
// Nothing is generated, stock, or illustrative.
//
// PRODUCT ATTRIBUTION — how each frame was assigned, and how sure we are:
//   Vault     DSC05790 / DSC04876   CONFIRMED (named in the archive audit)
//   Mini Luna DSC05774              CONFIRMED (named in the archive audit)
//   Loco      DSC05765 / DSC05772   CONFIRMED (named in the archive audit)
//   Nova      DSC05787 / DSC05780   INFERRED from shape family — 22 frames
//             share one handle-less low-wide pouch silhouette distinct from
//             the other three products, and Nova is the only product that
//             fits. Not client-confirmed. See docs/3d-production/
//             PRODUCT-GEOMETRY-MAP.md §0.3.
//
// This is deliberately separate from `Bag.images` (public.product_images),
// which is still empty. When Rand's photography is imported into the database
// properly, product_images becomes the source of truth and this file is the
// fallback beneath it — resolveProductMedia() already prefers the database.

import type { Bag } from "@/lib/types";

export interface ProductMedia {
  /**
   * Alpha cut-out (background removed by scripts/make-cutouts.mjs). This is
   * what editorial layouts use: the source frames sit on a LIT GREY seamless,
   * so `mix-blend-mode: multiply` — which only erases pure white — left a
   * visible grey rectangle over the pink field. Confirmed in a real browser
   * screenshot, fixed with a real alpha channel.
   */
  src: string;
  srcSmall: string;
  alt: string;
  /** Measured width:height of the object itself, from scripts/lib-object-bbox.mjs. */
  objectRatio: number;
  attribution: "confirmed" | "inferred";
}

const BY_NAME: Record<string, ProductMedia> = {
  nova: {
    src: "/media/nova-gold-cut-1200.webp",
    srcSmall: "/media/nova-gold-cut-600.webp",
    alt: "Nova, hand-crocheted in metallic gold ribbon yarn",
    objectRatio: 1.5,
    attribution: "inferred",
  },
  vault: {
    src: "/media/vault-brown-cut-1200.webp",
    srcSmall: "/media/vault-brown-cut-600.webp",
    alt: "Vault, hand-crocheted in brown, with its cut hand-slot top band",
    objectRatio: 1.32,
    attribution: "confirmed",
  },
  "mini luna": {
    src: "/media/mini-luna-red-cut-1200.webp",
    srcSmall: "/media/mini-luna-red-cut-600.webp",
    alt: "Mini Luna, hand-crocheted in metallic red with its large arched handle",
    objectRatio: 1.08,
    attribution: "confirmed",
  },
  loco: {
    src: "/media/loco-brown-cut-1200.webp",
    srcSmall: "/media/loco-brown-cut-600.webp",
    alt: "Loco, hand-crocheted in brown with its full-length fringe",
    objectRatio: 1.57,
    attribution: "confirmed",
  },
};

export const TEXTURES = {
  metallic: { src: "/media/texture-metallic.webp", alt: "Close detail of metallic ribbon yarn, hand-crocheted" },
  fringe: { src: "/media/texture-fringe.webp", alt: "Close detail of hand-knotted fringe" },
  chunky: { src: "/media/texture-chunky.webp", alt: "Close detail of chunky hand-crocheted stitchwork" },
} as const;

/**
 * Real photography for a product, or null. Prefers imported database imagery
 * (public.product_images) the moment any exists; falls back to the manifest
 * above. Returning null is a normal state — the caller shows BagArt.
 */
/**
 * Colourway-accurate lookup: product name + colour name -> the one imported
 * frame that actually shows THAT colourway.
 *
 * Keyed by colour so a customer selecting Black never sees the Gold photo.
 * Showing a different colourway's photo would be a lie about the product, and
 * is the exact failure the gallery's existing fallback rule guards against.
 */
const BY_PRODUCT_COLOUR: Record<string, ProductMedia> = {
  "nova|gold": BY_NAME.nova,
  "nova|black": {
    src: "/media/nova-black-cut-1200.webp",
    srcSmall: "/media/nova-black-cut-600.webp",
    alt: "Nova, hand-crocheted in black",
    objectRatio: 2.1,
    attribution: "inferred",
  },
  "nova|silver & gold": {
    src: "/media/nova-silver-gold-cut-1200.webp",
    srcSmall: "/media/nova-silver-gold-cut-600.webp",
    alt: "Nova in the two-tone Silver & Gold colourway",
    objectRatio: 1.66,
    attribution: "inferred",
  },
  "vault|brown": BY_NAME.vault,
  "mini luna|red": BY_NAME["mini luna"],
  loco: BY_NAME.loco,
  "loco|brown": BY_NAME.loco,
  "loco|burgundy": {
    src: "/media/loco-burgundy-cut-1200.webp",
    srcSmall: "/media/loco-burgundy-cut-600.webp",
    alt: "Loco, hand-crocheted in burgundy with its full-length fringe",
    objectRatio: 1.57,
    attribution: "confirmed",
  },
};

export function resolveProductMediaForColour(bag: Bag, colourName: string | null | undefined): ProductMedia | null {
  const dbImage = bag.images?.[0];
  if (dbImage?.url) {
    return { src: dbImage.url, srcSmall: dbImage.url, alt: bag.name, objectRatio: 1.4, attribution: "confirmed" };
  }
  if (!colourName) return null;
  const key = `${bag.name.trim().toLowerCase()}|${colourName.trim().toLowerCase()}`;
  return BY_PRODUCT_COLOUR[key] ?? null;
}

export function resolveProductMedia(bag: Bag): ProductMedia | null {
  const dbImage = bag.images?.[0];
  if (dbImage?.url) {
    return {
      src: dbImage.url,
      srcSmall: dbImage.url,
      alt: bag.name,
      objectRatio: 1.4,
      attribution: "confirmed",
    };
  }
  return BY_NAME[bag.name.trim().toLowerCase()] ?? null;
}
