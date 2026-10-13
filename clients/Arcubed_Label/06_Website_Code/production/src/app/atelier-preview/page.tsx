// Arcubed Atelier — the client preview of the colour studio, made to be
// shared with Rand as one link (WhatsApp). No sign-in: it shows only what the
// shop already publishes (the four bags, their colours, sizes, fittings and
// prices) plus digital colour previews drawn in the viewer's own browser.
// Nothing can be ordered from it, and it reads no private data.
//
// UNLISTED AND REVIEW-ONLY: noindex/nofollow, linked from nowhere, absent
// from the sitemap, and it answers 404 on any PRODUCTION deployment
// (arcubed.shop), so releasing this commit cannot publish it there.

import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getBagBySlug, getStoreSettings } from "@/lib/repository";
import { plainText } from "@/lib/site-settings";
import AtelierPreview from "./AtelierPreview";

export const dynamic = "force-dynamic";

const TITLE = "Arcubed Atelier";
const DESCRIPTION = "Choose a bag and try it in different colours: the bag stays exactly the same, only the colour changes.";

export async function generateMetadata(): Promise<Metadata> {
  // The link card (WhatsApp, iMessage) needs absolute URLs on THIS host: the
  // site-wide metadataBase points at arcubed.shop, where this page does not exist.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = host ? `${proto}://${host}` : undefined;
  const image = { url: `${base ?? ""}/og/atelier-preview.jpg`, width: 1200, height: 630, alt: "The Arcubed Nova on a pink set" };
  return {
    title: { absolute: TITLE },
    description: DESCRIPTION,
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
    alternates: base ? { canonical: `${base}/atelier-preview` } : undefined,
    openGraph: { type: "website", siteName: "Arcubed", title: TITLE, description: DESCRIPTION, url: base ? `${base}/atelier-preview` : undefined, images: [image] },
    twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [image.url] },
  };
}

export default async function AtelierPreviewPage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  const slugs = ["nova", "mini-luna", "vault", "loco"];
  const [found, settings] = await Promise.all([Promise.all(slugs.map((s) => getBagBySlug(s))), getStoreSettings()]);
  const bags = found.filter((b): b is NonNullable<typeof b> => Boolean(b));
  if (!bags.length) notFound();
  const productionTime = settings?.productionTimeLabel ? plainText(settings.productionTimeLabel) : null;
  return <AtelierPreview bags={bags} productionTime={productionTime} />;
}
