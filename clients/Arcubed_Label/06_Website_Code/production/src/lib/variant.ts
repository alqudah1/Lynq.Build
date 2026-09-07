/**
 * Colourway addressing.
 *
 * A Shop tile is a PRODUCT AND A COLOUR. Before this existed the link carried
 * only the product, so every tile opened on `bag.colours[0]` — clicking Silver
 * Mini Luna opened Red and the customer had to choose Silver again. The colour
 * now travels in the URL, is resolved on the server, and is what the page
 * renders from, so there is no wrong-colour first paint to correct.
 *
 * Slugs are derived from the colour NAME rather than its database id: ids are
 * opaque UUIDs that would make the URL unreadable and would break if the row
 * were ever recreated, whereas the name is what the customer is choosing.
 */
import type { Bag, Colour } from "./types";

export function colourSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The colour a `?colour=` value refers to, or null if it names nothing real. */
export function resolveColour(bag: Bag, slug: string | undefined | null): Colour | null {
  if (!slug) return null;
  const want = colourSlug(slug);
  return bag.colours.find((c) => colourSlug(c.name) === want) ?? null;
}

/** Canonical link to one product in one colourway. */
export function variantHref(bagSlug: string, colourName?: string | null): string {
  return colourName ? `/product/${bagSlug}?colour=${colourSlug(colourName)}` : `/product/${bagSlug}`;
}

/**
 * The first `?colour=` value from Next's searchParams, which may be a string,
 * an array, or absent.
 */
export function colourParam(sp: Record<string, string | string[] | undefined> | undefined): string | null {
  const raw = sp?.colour;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw ?? null;
}
