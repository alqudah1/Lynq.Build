"use client";

// The product itself is fetched server-side (page.tsx), and so is ?edit=: the
// Atelier is in the first HTML, so nothing moves when the page hydrates. (It
// used to read ?edit= with useSearchParams inside a Suspense boundary whose
// fallback was empty: the page arrived without its product, the footer showed
// at the top of the screen, and was then pushed away, a layout shift on every
// product page.) Only the cart line being edited needs the browser, because
// the cart lives in localStorage.

import type { Bag } from "@/lib/types";
import { useCart } from "@/lib/cart-context";
import Atelier from "@/components/atelier/Atelier";

export default function ProductPageClient({
  bag,
  initialColourId,
  productionTimeLabel,
  editLineId,
}: {
  bag: Bag;
  initialColourId: string | null;
  productionTimeLabel: string | null;
  editLineId: string | null;
}) {
  const { cart, hydrated } = useCart();
  // Only a made-to-order line is ever editable — a Ready for Delivery line
  // has no live configuration to reopen.
  const found = editLineId ? cart.find((l) => l.lineId === editLineId) ?? null : null;
  const editingLine = found && found.kind === "made_to_order" ? found : null;
  // Editing: wait for the cart before mounting, so the line's options (not
  // the defaults) are what appears.
  if (editLineId && !hydrated) return null;

  return (
    // The Colour Atelier Rand approved (2026-10-13) is the product page.
    <div className="cl at-shop">
      <Atelier
        key={`${editingLine?.lineId ?? bag.id}:${initialColourId ?? ""}`}
        bag={bag}
        mode="shop"
        initialColourId={initialColourId}
        editingLine={editingLine}
        productionTime={productionTimeLabel}
      />
    </div>
  );
}
