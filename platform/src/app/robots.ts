import type { MetadataRoute } from "next";

/**
 * app.lynq.build/robots.txt. Crawling stays allowed on purpose: a crawler has to fetch a page to see
 * its `noindex` (the X-Robots-Tag header in next.config.ts and the robots meta in layout.tsx).
 * A `Disallow: /` here would hide that signal and leave already-indexed URLs in search results.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/" }] };
}
