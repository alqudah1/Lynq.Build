import type { MetadataRoute } from "next";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://arcubed-label.vercel.app";

/**
 * Closed by default. Arcubed has not been approved for launch, and shipping an
 * open robots.txt before the client says go is how a half-finished storefront
 * ends up in search results. Flip NEXT_PUBLIC_ALLOW_INDEXING to open it.
 *
 * /admin, /dev and /order are never crawlable in either state: /order carries
 * unguessable customer tokens, and the other two are not public surfaces.
 */
export default function robots(): MetadataRoute.Robots {
  const open = process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true";
  return {
    rules: open
      ? { userAgent: "*", allow: "/", disallow: ["/admin", "/dev", "/order", "/checkout", "/cart"] }
      : { userAgent: "*", disallow: "/" },
    sitemap: `${SITE}/sitemap.xml`,
  };
}
