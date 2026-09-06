// Server Component: fetches the product server-side (repository.ts is
// server-only). The cart-edit lookup depends on client-side cart state
// (localStorage), so that part — and the Customizer itself — lives in the
// client wrapper below.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBagBySlug, getStoreSettings } from "@/lib/repository";
import { formatMoney } from "@/lib/site-settings";
import ProductPageClient from "./ProductPageClient";

// Every route previously rendered the same site-wide <title>, so four product
// pages were indistinguishable in a browser tab, in history and in search.
export async function generateMetadata(props: PageProps<"/product/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const bag = await getBagBySlug(slug);
  if (!bag) return { title: "Arcubed Label" };
  return {
    title: `${bag.name} — Arcubed Label`,
    description: `${bag.tagline} Hand-crocheted to order, from ${formatMoney(bag.basePrice, "JOD")}.`,
  };
}

// Live catalog data should never be prerendered — see app/page.tsx for why
// this must be explicit rather than inferred.
export const dynamic = "force-dynamic";

export default async function ProductPage(props: PageProps<"/product/[slug]">) {
  const { slug } = await props.params;
  const [bag, storeSettings] = await Promise.all([getBagBySlug(slug), getStoreSettings()]);
  if (!bag) notFound();

  return <ProductPageClient bag={bag} productionTimeLabel={storeSettings?.productionTimeLabel ?? null} />;
}
