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
