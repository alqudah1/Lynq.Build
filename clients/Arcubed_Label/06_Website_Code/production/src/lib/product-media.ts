// Customer-facing media resolution.
//
// PRECEDENCE (docs/3d-production rule, restated):
//   1. approved production 3D            — none exists for any product today
//   2. exact real product+colour photo   — COLOUR_MEDIA, keyed on colourway
//   3. confirmed real product photo      — that product's other colourways
//   4. intentional editorial fallback    — never a generic illustrated bag
//
// The generic BagArt placeholder is NOT the Arcubed identity and must not
// stand in where real photography exists. Every purchasable colourway of all
// four products has real photography (see src/lib/media-manifest.ts), so on
// the storefront tier 2 always resolves — BagArt is reachable only if the
// catalogue gains a colourway before its shoot.

import { COLOUR_MEDIA, EDITORIAL_ONLY, TEXTURES, type Frame } from "./media-manifest";
import type { Bag } from "./types";

export type { Frame };
export { TEXTURES };

export interface ResolvedMedia {
  frame: Frame;
  /** True when this photo is of the SELECTED colourway. */
  exactColour: boolean;
  /** Which colourway the photo actually shows — for honest labelling. */
  shownColour: string;
}

function productKey(bag: Pick<Bag, "slug" | "name">): string {
  return (bag.slug || bag.name).trim().toLowerCase().replace(/\s+/g, "-");
}

/** Every frame for one product+colourway, in gallery order. */
export function framesForColour(bag: Pick<Bag, "slug" | "name">, colourName: string | null | undefined): Frame[] {
  const product = COLOUR_MEDIA[productKey(bag)];
  if (!product || !colourName) return [];
  return product[colourName] ?? [];
}

/** Every frame for a product across all its colourways. */
export function allFramesFor(bag: Pick<Bag, "slug" | "name">): Frame[] {
  const product = COLOUR_MEDIA[productKey(bag)];
  return product ? Object.values(product).flat() : [];
}

/** The colourways this product actually has photography for. */
export function photographedColours(bag: Pick<Bag, "slug" | "name">): string[] {
  return Object.keys(COLOUR_MEDIA[productKey(bag)] ?? {});
}

/**
 * The single best image for a product at a given colourway.
 *
 * Returns `exactColour: false` when it had to fall back to another colourway
 * — callers MUST NOT imply the image shows the selected colour in that case.
 * Silently showing the wrong colour is the failure this flag exists to stop.
 */
export function resolveMedia(bag: Pick<Bag, "slug" | "name" | "images">, colourName?: string | null): ResolvedMedia | null {
  const dbImage = bag.images?.[0];
  if (dbImage?.url) {
    return {
      frame: { photo: dbImage.url, photoSmall: dbImage.url, cut: dbImage.url, cutSmall: dbImage.url, ratio: 1.4, frameId: "db", cutOk: false },
      exactColour: true,
      shownColour: colourName ?? "",
    };
  }
  const exact = framesForColour(bag, colourName);
  if (exact.length) return { frame: exact[0], exactColour: true, shownColour: colourName as string };

  const product = COLOUR_MEDIA[productKey(bag)];
  if (!product) return null;
  const [firstColour, frames] = Object.entries(product)[0] ?? [];
  if (!frames?.length) return null;
  return { frame: frames[0], exactColour: false, shownColour: firstColour };
}

/**
 * Source for a cut-out composition. Falls back to the framed photograph when
 * visual QA rejected the cut-out (Loco: backdrop retained between fringe
 * strands). A damaged cut-out looks worse than honest photography.
 */
export function cutSrc(frame: Frame, small = false): string {
  if (!frame.cutOk) return small ? frame.photoSmall : frame.photo;
  return small ? frame.cutSmall : frame.cut;
}

export function hasCleanCut(frame: Frame | undefined | null): boolean {
  return Boolean(frame?.cutOk);
}

/** Photographed but unbuyable colourways — editorial use only, never labelled as options. */
export function editorialFrames(slug: string): Frame[] {
  return EDITORIAL_ONLY[slug] ?? [];
}

export function altFor(bag: Pick<Bag, "name">, colour: string | null, exact = true): string {
  const base = `${bag.name}, hand-crocheted by Arcubed`;
  return colour && exact ? `${base} — ${colour}` : base;
}

/**
 * Thumbnail for a cart/order line, from the SAME canonical map the storefront
 * uses — there is deliberately no second mapping system.
 *
 * Cart snapshots carry bagSlug + colourName, which is exactly the key
 * COLOUR_MEDIA is built on, so "Nova Black" in the cart shows the black Nova
 * and never a generic or wrong-colour thumbnail.
 */
export function mediaForSnapshot(
  bagSlug: string | null | undefined,
  bagName: string | null | undefined,
  colourName: string | null | undefined
): Frame | null {
  if (!bagSlug && !bagName) return null;
  const bag = { slug: bagSlug ?? "", name: bagName ?? "" };
  const exact = framesForColour(bag, colourName);
  if (exact.length) return exact[0];
  const any = allFramesFor(bag);
  return any[0] ?? null;
}
