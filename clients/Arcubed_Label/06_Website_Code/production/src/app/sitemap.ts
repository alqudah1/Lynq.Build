import type { MetadataRoute } from "next";
import { getActiveBags } from "@/lib/repository";
import { COLLECTION } from "@/lib/collection";
import { variantHref } from "@/lib/variant";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://arcubed-label.vercel.app";

/**
 * Public pages plus one entry per verified COLOURWAY, because a colourway is a
 * real addressable page now (src/lib/variant.ts) and is what a shopper
 * actually searches for. Cart, checkout, order, admin and dev are omitted:
 * they are either private, transient, or not public surfaces.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const bags = await getActiveBags();
  const slugs = new Set(bags.map((b) => b.slug));

  const staticPages = ["", "/shop", "/ready-for-delivery", "/about", "/faq", "/contact"].map((p) => ({
    url: `${SITE}${p}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: p === "" ? 1 : 0.8,
  }));

  const products = bags.map((b) => ({
    url: `${SITE}/product/${b.slug}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.9,
  }));

  const colourways = COLLECTION.filter((c) => slugs.has(c.slug)).map((c) => ({
    url: `${SITE}${variantHref(c.slug, c.colour)}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  return [...staticPages, ...products, ...colourways];
}
