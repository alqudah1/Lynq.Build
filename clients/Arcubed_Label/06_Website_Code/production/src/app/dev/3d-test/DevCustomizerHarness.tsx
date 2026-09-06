"use client";

// Renders the REAL production Customizer component (same code path Nova/
// Vault/Mini Luna/Loco will use the moment they have a real product_models
// row) against the dev-only placeholder bag — this is what actually proves
// rotate/zoom, live colour + two-tone updates, strap/chain swap, live
// pricing, and add-to-cart-with-3D-config all work, not a reimplementation
// of the customizer for testing purposes.

import type { Bag } from "@/lib/types";
import Customizer from "@/components/customizer/Customizer";

export default function DevCustomizerHarness({ bag }: { bag: Bag }) {
  return <Customizer bag={bag} editingLine={null} productionTimeLabel="DEV TEST — 3–5 business days" />;
}
