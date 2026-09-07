"use client";

// The product itself is already fetched server-side (page.tsx). This client
// wrapper only handles the part that genuinely needs the browser: resolving
// ?edit=<lineId> against the localStorage-backed cart. useSearchParams still
// needs its own Suspense boundary per Next.js docs, so the page can prerender
// around it.

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { Bag } from "@/lib/types";
import { useCart } from "@/lib/cart-context";
import Customizer from "@/components/customizer/Customizer";

function ProductPageInner({ bag, initialColourId, productionTimeLabel }: { bag: Bag; initialColourId: string | null; productionTimeLabel: string | null }) {
  const searchParams = useSearchParams();
  const { cart, hydrated } = useCart();

  const editLineId = searchParams.get("edit");
  // Only a made-to-order line is ever editable via the customizer — a
  // Ready for Delivery line has no live configuration to reopen.
  const found = editLineId ? cart.find((l) => l.lineId === editLineId) ?? null : null;
  const editingLine = found && found.kind === "made_to_order" ? found : null;

  // Waiting on the localStorage-backed cart to hydrate before mounting the
  // customizer avoids a flash of default options when editing an existing line.
  if (editLineId && !hydrated) {
    return null;
  }

  return (
    <Customizer
      key={`${editingLine?.lineId ?? bag.id}:${initialColourId ?? ""}`}
      bag={bag}
      initialColourId={initialColourId}
      editingLine={editingLine}
      productionTimeLabel={productionTimeLabel}
    />
  );
}

export default function ProductPageClient({
  bag,
  initialColourId,
  productionTimeLabel,
}: {
  bag: Bag;
  initialColourId: string | null;
  productionTimeLabel: string | null;
}) {
  return (
    <Suspense fallback={null}>
      <ProductPageInner bag={bag} initialColourId={initialColourId} productionTimeLabel={productionTimeLabel} />
    </Suspense>
  );
}
