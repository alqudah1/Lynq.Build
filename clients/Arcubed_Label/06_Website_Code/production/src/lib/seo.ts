import type { Metadata } from "next";

// The public address and the indexing switch, in one place. layout.tsx,
// robots.ts and sitemap.ts each carried their own copy of the fallback, and
// all three still pointed at arcubed-label.vercel.app after the store moved to
// arcubed.shop — so every canonical, the sitemap and robots.txt sent search
// engines to the Vercel hostname.

/** The store's real address. NEXT_PUBLIC_SITE_URL still overrides it. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://arcubed.shop";

/**
 * Open since launch (2026-10-05). Set NEXT_PUBLIC_ALLOW_INDEXING=false to
 * close the whole site again. Private routes are excluded either way: each
 * sets its own noindex and robots.txt disallows them.
 */
export const INDEXING_OPEN = process.env.NEXT_PUBLIC_ALLOW_INDEXING !== "false";

/**
 * The Open Graph fields every page shares. A page that sets `openGraph` at all
 * REPLACES the layout's block rather than merging with it, so pages must
 * spread this in or they lose the share image, site name and locale.
 */
export const SITE_OPEN_GRAPH = {
  type: "website",
  siteName: "Arcubed Label",
  title: "Arcubed Label | Handmade Crochet Bags",
  description:
    "Hand-crocheted bags made to order in Amman, Jordan. Choose your shape, your colour and your fittings.",
  locale: "en_JO",
  // Nova leads the collection (client, 2026-09), so it is what a shared
  // link shows: the real Gold Nova cut-out on the brand field.
  images: [{ url: "/media/og-nova.jpg", width: 1200, height: 630, alt: "Nova in Gold, hand-crocheted by Arcubed" }],
} satisfies Metadata["openGraph"];

/**
 * A public page's own address, as both its canonical and its og:url, so the
 * two can never disagree. Relative paths resolve against metadataBase
 * (SITE_URL). Spread into a page's metadata.
 */
export function pageUrls(path: string): Pick<Metadata, "alternates" | "openGraph"> {
  return { alternates: { canonical: path }, openGraph: { ...SITE_OPEN_GRAPH, url: path } };
}
