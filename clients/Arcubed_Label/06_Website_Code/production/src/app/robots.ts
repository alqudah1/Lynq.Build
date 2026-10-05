import type { MetadataRoute } from "next";
import { SITE_URL as SITE, INDEXING_OPEN } from "@/lib/seo";

/**
 * Open since launch (2026-10-05); NEXT_PUBLIC_ALLOW_INDEXING=false closes the
 * whole site again (src/lib/seo.ts).
 *
 * /admin, /dev, /order, /checkout and /cart are never crawlable: /order carries
 * unguessable customer tokens, and the rest are not public surfaces. Each of
 * them also sets noindex at page level (or 404s, for /dev), so the two agree.
 */
export default function robots(): MetadataRoute.Robots {
  const open = INDEXING_OPEN;
  return {
    rules: open
      ? { userAgent: "*", allow: "/", disallow: ["/admin", "/dev", "/order", "/checkout", "/cart"] }
      : { userAgent: "*", disallow: "/" },
    sitemap: `${SITE}/sitemap.xml`,
  };
}
