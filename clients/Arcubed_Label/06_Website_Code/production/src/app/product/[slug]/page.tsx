// Server Component: fetches the product server-side (repository.ts is
// server-only). The cart-edit lookup depends on client-side cart state
// (localStorage), so that part — and the Customizer itself — lives in the
// client wrapper below.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBagBySlug, getStoreSettings } from "@/lib/repository";
import { resolveColour, colourParam } from "@/lib/variant";
import { formatMoney, plainText } from "@/lib/site-settings";
import ProductPageClient from "./ProductPageClient";

// Every route previously rendered the same site-wide <title>, so four product
// pages were indistinguishable in a browser tab, in history and in search.
export async function generateMetadata(props: PageProps<"/product/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const bag = await getBagBySlug(slug);
  if (!bag) return { title: "Arcubed Label" };
  const colour = resolveColour(bag, colourParam(await props.searchParams));
  const name = colour ? `${bag.name} in ${colour.name}` : bag.name;
  return {
    title: name,
    // tagline is empty for every product in the catalogue today, which left
    // each description starting with a stray space and carrying no product
    // detail at all. Falls back to the material/production facts already
    // published in the FAQ rather than to invented marketing copy.
    description: [
      bag.tagline,
      `${bag.name}. Hand-crocheted to order in 100% cotton yarn, from ${formatMoney(bag.basePrice, "JOD")}.`,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

// Live catalog data should never be prerendered — see app/page.tsx for why
// this must be explicit rather than inferred.
export const dynamic = "force-dynamic";

export default async function ProductPage(props: PageProps<"/product/[slug]">) {
  const { slug } = await props.params;
  const searchParams = await props.searchParams;
  const [bag, storeSettings] = await Promise.all([getBagBySlug(slug), getStoreSettings()]);
  if (!bag) notFound();

  // Resolved HERE, on the server, so the first paint already carries the right
  // colour and its photography. Resolving it after hydration would render Red,
  // then swap to Silver in front of the customer.
  const initialColour = resolveColour(bag, colourParam(searchParams));

  return (
    <ProductPageClient
      bag={bag}
      initialColourId={initialColour?.id ?? null}
      productionTimeLabel={storeSettings?.productionTimeLabel ? plainText(storeSettings.productionTimeLabel) : null}
    />
  );
}
