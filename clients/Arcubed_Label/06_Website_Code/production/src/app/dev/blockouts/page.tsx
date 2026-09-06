// DEVELOPMENT ONLY — evidence-driven massing studies for the four Arcubed
// bodies. 404s in production via this guard plus src/proxy.ts's /dev/* rule.
//
// These are NOT products and produce NO GLB. Nothing here is written to
// public/models/arcubed/, nothing is linked to model_assets/product_models,
// and the storefront continues to use real photography. See
// src/lib/three/blockouts/evidence.ts for what every number is worth.

import { notFound } from "next/navigation";
import BlockoutStage from "./BlockoutStage";
import Comparison from "./Comparison";

export const dynamic = "force-dynamic";

export default function DevBlockoutsPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return (
    <div style={{ padding: 24, maxWidth: 1180, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>Arcubed body blockouts — dev only</h1>
      <p style={{ margin: "0 0 20px", color: "#6f665e", fontSize: 14, maxWidth: "72ch" }}>
        Massing studies traced from the archive photography. Flat material by design — yarn
        texture and colourways are deliberately not built yet. Every dimension is graded in the
        panel on the right; nothing graded APPROXIMATION FOR BLOCKOUT or UNRESOLVED may be
        promoted to a production asset.
      </p>
      <BlockoutStage />
      <Comparison />
    </div>
  );
}
