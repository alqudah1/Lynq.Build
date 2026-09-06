// DEVELOPMENT ONLY — proves the 3D viewer pipeline end-to-end (rotate/zoom,
// live colour + two-tone material updates, strap/chain swap, live price,
// add-to-cart with a preserved 3D configuration) using the placeholder test
// geometry in public/models/dev/*.glb — NOT real Arcubed product art. See
// docs/3d-assets.md.
//
// Never reachable in production, even by guessing the URL: the placeholder
// model_assets rows this reads are is_placeholder=true, which the public
// "anon" RLS policy on model_assets excludes — only the service-role admin
// client (used here) can see them at all. This route is an extra layer of
// intentional friction on top of that, not the only thing preventing leakage.

import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Bag } from "@/lib/types";
import DevCustomizerHarness from "./DevCustomizerHarness";

export const dynamic = "force-dynamic";

async function getPlaceholderAssets() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("model_assets")
    .select("id, kind, glb_url, version")
    .eq("is_placeholder", true)
    .eq("active", true);
  if (error) throw error;
  return data ?? [];
}

export default async function Dev3DTestPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  let assets: Awaited<ReturnType<typeof getPlaceholderAssets>>;
  try {
    assets = await getPlaceholderAssets();
  } catch {
    return (
      <section className="section">
        <p className="eyebrow">DEV 3D TEST</p>
        <h1>Can&rsquo;t reach Supabase</h1>
        <p className="page-copy">
          This page reads the placeholder model_assets rows via the admin client — it needs a live
          Supabase connection (see .env.local). This is a dev-only tool, not part of the storefront.
        </p>
      </section>
    );
  }

  const body = assets.find((a) => a.kind === "body");
  const strap = assets.find((a) => a.kind === "strap");
  const chain = assets.find((a) => a.kind === "chain");

  if (!body) {
    return (
      <section className="section">
        <p className="eyebrow">DEV 3D TEST</p>
        <h1>No placeholder body asset found</h1>
        <p className="page-copy">
          Expected a model_assets row with kind=&quot;body&quot; and is_placeholder=true — see
          supabase/migrations/20260902130200_seed_dev_placeholder_model_assets.sql.
        </p>
      </section>
    );
  }

  // A fixture bag that exists ONLY on this page — deliberately not part of
  // MOCK_BAGS/data.ts, so it can never be picked up by the real
  // getActiveBags()/getBagBySlug() fallback paths. Two colours (one
  // two-tone) so the two-tone selector path gets exercised too.
  const devBag: Bag = {
    id: "dev-test-bag",
    slug: "dev-test-bag",
    name: "DEV TEST — Placeholder Bag",
    tagline: "Development-only geometry — not a real Arcubed product.",
    basePrice: 0,
    images: [],
    colours: [
      { id: "dev-navy", name: "DEV TEST — Navy", hex: "#143562", isTwoTone: false, materialRef: null },
      { id: "dev-pink", name: "DEV TEST — Pale Pink", hex: "#FFE0FD", isTwoTone: false, materialRef: null },
      { id: "dev-two-tone", name: "DEV TEST — Two-Tone", hex: "#B8860B", isTwoTone: true, materialRef: null },
    ],
    straps: strap
      ? [
          {
            id: "dev-strap",
            label: "DEV TEST — Strap",
            priceDelta: 5,
            art: "woven",
            model3D: { assetId: strap.id, glbUrl: strap.glb_url, version: strap.version },
          },
        ]
      : undefined,
    chains: chain
      ? [
          {
            id: "dev-chain",
            label: "DEV TEST — Chain",
            priceDelta: 5,
            art: "chain",
            model3D: { assetId: chain.id, glbUrl: chain.glb_url, version: chain.version },
          },
        ]
      : undefined,
    model3D: { assetId: body.id, glbUrl: body.glb_url, version: body.version },
  };

  return (
    <section className="section">
      <p className="eyebrow">DEV 3D TEST — not a real product</p>
      <DevCustomizerHarness bag={devBag} />
    </section>
  );
}
