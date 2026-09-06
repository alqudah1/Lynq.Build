"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Bag, CartItem, Selection } from "@/lib/types";
import { computeUnitPrice, defaultSelectionFor, buildCartSnapshot } from "@/lib/pricing";
import { useCart, uid } from "@/lib/cart-context";
import { showToast } from "@/lib/toast";
import ProductGallery from "./ProductGallery";
import ColourSelector from "./ColourSelector";
import TwoToneSelector from "./TwoToneSelector";
import SizeSelector from "./SizeSelector";
import StrapHandleSelector from "./StrapHandleSelector";
import AddonSelector from "./AddonSelector";
import PriceDisplay from "./PriceDisplay";
import { AddToCartInline, AddToCartStickyBar } from "./AddToCartControls";

export default function Customizer({
  bag,
  editingLine,
  productionTimeLabel,
}: {
  bag: Bag;
  editingLine: CartItem | null;
  // Passed down from the Server Component page (see product/[slug]/page.tsx)
  // rather than imported as a static constant — production time is a real
  // DB-backed fact (public.store_settings) now, not hardcoded copy. Null
  // when the settings read failed; the accordion falls back to generic copy.
  productionTimeLabel: string | null;
}) {
  const router = useRouter();
  const { addOrUpdateLine } = useCart();

  const [selection, setSelection] = useState<Selection>(() =>
    editingLine
      ? {
          colourId: editingLine.colourId,
          secondaryColourId: editingLine.secondaryColourId,
          sizeId: editingLine.sizeId,
          strapId: editingLine.strapId,
          handleId: editingLine.handleId,
          chainId: editingLine.chainId,
          addonIds: [...editingLine.addonIds],
        }
      : defaultSelectionFor(bag)
  );

  const price = computeUnitPrice(bag, selection);
  const actionLabel = editingLine ? "Save Changes" : "Add to Bag";

  function handleAdd() {
    const line: CartItem = {
      kind: "made_to_order",
      lineId: editingLine?.lineId ?? uid(),
      bagId: bag.id,
      colourId: selection.colourId,
      secondaryColourId: selection.secondaryColourId,
      sizeId: selection.sizeId,
      strapId: selection.strapId,
      handleId: selection.handleId,
      chainId: selection.chainId,
      addonIds: [...selection.addonIds],
      qty: editingLine?.qty ?? 1,
      unitPrice: price,
      snapshot: buildCartSnapshot(bag, selection),
    };
    addOrUpdateLine(line, editingLine?.lineId ?? null);
    showToast(editingLine ? "Bag updated." : "Added to your bag.");
    router.push("/cart");
  }

  function toggleAddon(id: string) {
    setSelection((prev) => {
      const has = prev.addonIds.includes(id);
      return { ...prev, addonIds: has ? prev.addonIds.filter((a) => a !== id) : [...prev.addonIds, id] };
    });
  }

  return (
    <section className="product">
      <ProductGallery bag={bag} selection={selection} />

      <div className="product-panel">
        <p className="eyebrow">{bag.tagline}</p>
        <h1>{bag.name}</h1>
        <PriceDisplay price={price} className="price-inline" />
        {productionTimeLabel ? (
          <p className="production-note">Handmade to order · Ships in {productionTimeLabel}</p>
        ) : null}

        <ColourSelector
          colours={bag.colours}
          selectedId={selection.colourId}
          onSelect={(colourId) => setSelection((prev) => ({ ...prev, colourId }))}
        />

        {bag.colours.some((c) => c.isTwoTone) ? (
          <TwoToneSelector
            colours={bag.colours.filter((c) => c.isTwoTone)}
            selectedId={selection.secondaryColourId}
            onSelect={(secondaryColourId) => setSelection((prev) => ({ ...prev, secondaryColourId }))}
          />
        ) : null}

        {bag.sizes ? (
          <SizeSelector
            sizes={bag.sizes}
            selectedId={selection.sizeId}
            onSelect={(sizeId) => setSelection((prev) => ({ ...prev, sizeId }))}
          />
        ) : null}

        {bag.straps ? (
          <StrapHandleSelector
            label="Strap"
            kind="strap"
            bag={bag}
            options={bag.straps}
            selectedId={selection.strapId}
            colourId={selection.colourId}
            onSelect={(strapId) => setSelection((prev) => ({ ...prev, strapId }))}
          />
        ) : null}

        {bag.handles ? (
          <StrapHandleSelector
            label="Handle"
            kind="handle"
            bag={bag}
            options={bag.handles}
            selectedId={selection.handleId}
            colourId={selection.colourId}
            onSelect={(handleId) => setSelection((prev) => ({ ...prev, handleId }))}
          />
        ) : null}

        {bag.chains ? (
          <StrapHandleSelector
            label="Chain"
            kind="chain"
            bag={bag}
            options={bag.chains}
            selectedId={selection.chainId}
            colourId={selection.colourId}
            onSelect={(chainId) => setSelection((prev) => ({ ...prev, chainId }))}
          />
        ) : null}

        {bag.addons ? (
          <AddonSelector
            addons={bag.addons}
            selectedIds={selection.addonIds}
            colourId={selection.colourId}
            onToggle={toggleAddon}
          />
        ) : null}

        <AddToCartInline label={actionLabel} onClick={handleAdd} />

        <div className="accordion-group">
          <details>
            <summary>Materials &amp; Care</summary>
            <p>100% cotton yarn, hand-crocheted. Spot clean, air dry.</p>
          </details>
          {bag.sizes ? (
            <details>
              <summary>Sizing</summary>
              <p>See dimensions under each size option above.</p>
            </details>
          ) : null}
          <details>
            <summary>Production time</summary>
            <p>{productionTimeLabel ?? "Handmade to order — exact timing available on request."}</p>
          </details>
        </div>
      </div>

      <AddToCartStickyBar price={price} label={actionLabel} onClick={handleAdd} />
    </section>
  );
}
