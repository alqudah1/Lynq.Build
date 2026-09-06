// DEVELOPMENT ONLY — load an arbitrary candidate GLB by URL, validate it
// against a chosen product's contract, and visually inspect it (rotate/
// zoom, toggle test colours, attach the dev strap/chain to check alignment)
// before it's ever linked to a real product_models/straps_handles row.
//
// Never reachable in production — same double gate as /dev/3d-test: this
// page's own notFound() call, plus src/proxy.ts's /dev/:path* block, which
// (unlike this page's notFound()) guarantees the actual HTTP status is 404.

import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import Inspector from "./Inspector";

export const dynamic = "force-dynamic";

async function getDevComponentUrls() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("model_assets")
    .select("kind, glb_url")
    .eq("is_placeholder", true)
    .eq("active", true);
  if (error) throw error;
  return {
    bodyUrl: data?.find((a) => a.kind === "body")?.glb_url,
    strapUrl: data?.find((a) => a.kind === "strap")?.glb_url,
    chainUrl: data?.find((a) => a.kind === "chain")?.glb_url,
  };
}

export default async function Dev3DInspectorPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  let devComponents: Awaited<ReturnType<typeof getDevComponentUrls>> = {
    bodyUrl: undefined,
    strapUrl: undefined,
    chainUrl: undefined,
  };
  try {
    devComponents = await getDevComponentUrls();
  } catch {
    // Non-fatal — the inspector still works for arbitrary-URL loading and
    // validation without the dev strap/chain alignment feature.
  }

  return (
    <section className="section">
      <p className="eyebrow">DEV 3D INSPECTOR — not part of the storefront</p>
      <Inspector
        devBodyUrl={devComponents.bodyUrl}
        devStrapUrl={devComponents.strapUrl}
        devChainUrl={devComponents.chainUrl}
      />
    </section>
  );
}
