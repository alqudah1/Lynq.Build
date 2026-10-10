"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Bag, CartItem, Selection } from "@/lib/types";
import { computeUnitPrice, defaultSelectionFor, buildCartSnapshot, money } from "@/lib/pricing";
import { useCart, uid } from "@/lib/cart-context";
import { showToast } from "@/lib/toast";
import ProductGallery from "./ProductGallery";
import ColourSelector from "./ColourSelector";
import SizeSelector from "./SizeSelector";
import StrapHandleSelector from "./StrapHandleSelector";
import AddonSelector from "./AddonSelector";
import PriceDisplay from "./PriceDisplay";
import { AddToCartInline, AddToCartStickyBar } from "./AddToCartControls";
import { srgbToLab, hexToRgb, type PreviewColour, type YarnProfile } from "@/lib/recolour/engine";
import { isPreviewOnly, APPROVED_PREVIEWS, type ApprovedPreview } from "@/lib/colour-previews";

/** Admin colour lab only: recoloured previews of colours with no photograph. */
export interface CustomizerPreview {
  colours: PreviewColour[];
  frame: string;
  profiles: YarnProfile[];
  /** The real colourway the source photograph shows, for the label. */
  sourceColour: string;
  /** Lightest yarn (L*) this source can show convincingly; lighter swatches are disabled. */
  maxLightness?: number;
}

export default function Customizer({
  bag,
  initialColourId,
  editingLine,
  productionTimeLabel,
  preview,
  approved = APPROVED_PREVIEWS,
  orderBlockedReason,
}: {
  bag: Bag;
  /** Colourway from the URL, resolved server-side. See src/lib/variant.ts. */
  initialColourId?: string | null;
  editingLine: CartItem | null;
  // Passed down from the Server Component page (see product/[slug]/page.tsx)
  // rather than imported as a static constant — production time is a real
  // DB-backed fact (public.store_settings) now, not hardcoded copy. Null
  // when the settings read failed; the accordion falls back to generic copy.
  productionTimeLabel: string | null;
  /** Never passed on the storefront. */
  preview?: CustomizerPreview;
  /** Approved digital previews. The lab passes a simulated set; the shop uses the real one. */
  approved?: Record<string, Record<string, ApprovedPreview>>;
  /** Lab only: refuse ordering with this message. */
  orderBlockedReason?: string;
}) {
  const router = useRouter();
  const { addOrUpdateLine, openCartDrawer } = useCart();
  // One press, one bag. A double tap on a phone fired handleAdd twice and put
  // two lines in the cart; the second press inside this window is ignored.
  const addLock = useRef(0);

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
      : defaultSelectionFor(bag, initialColourId)
  );

  // A preview colour is shown ON TOP of the configuration: size, handle,
  // strap/chain stay exactly as chosen, and picking a real colour again
  // simply drops the preview. It is never part of what can be ordered.
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const activePreview = preview?.colours.find((c) => c.key === previewKey) ?? null;

  const price = computeUnitPrice(bag, selection);
  const actionLabel = activePreview ? "Preview only" : orderBlockedReason ? "Lab only" : editingLine ? "Save Changes" : "Add to Cart";
  const colourName = bag.colours.find((c) => c.id === selection.colourId)?.name ?? "";
  // A confirmed colour shown as an approved digital preview (no photograph yet).
  const previewOnly = !activePreview && isPreviewOnly(bag, colourName, approved);

  function handleAdd() {
    if (activePreview) {
      showToast("Preview colours are not available to order.");
      return;
    }
    if (orderBlockedReason) {
      showToast(orderBlockedReason);
      return;
    }
    const now = Date.now();
    if (now - addLock.current < 800) return;
    addLock.current = now;
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
    const lineId = addOrUpdateLine(line, editingLine?.lineId ?? null);
    if (editingLine) {
      // Editing came FROM the cart, so saving goes back to it.
      showToast("Cart updated.");
      router.push("/cart");
      return;
    }
    // A new bag stays on this page, configuration intact, and the cart panel
    // offers the two ways on: View Cart or Keep Shopping.
    openCartDrawer(lineId);
  }

  // A STRAP OR A CHAIN, NOT BOTH (client, 2026-09: "we can add both a charm
  // and a strap at the same time"). Both are the thing the bag is carried by,
  // so choosing one clears the other rather than stacking two carrying
  // options, and two +5 charges, on one bag. Nova's handle is a separate
  // question (with or without) and is not affected.
  //
  // ASSUMPTION (launch, 2026-10-05): Rand's note says "charm", but no Charm
  // exists in the confirmed product matrix — the accessory in that role is
  // the Chain, so "charm" is read as Chain. No Charm option, image or price
  // was created, and customers only ever see "Chain". If Rand later means a
  // separate charm product, it needs its own option and price, and this rule
  // must be revisited.
  const pickStrap = (strapId: string | null) =>
    setSelection((prev) => ({ ...prev, strapId, chainId: strapId ? null : prev.chainId }));
  const pickChain = (chainId: string | null) =>
    setSelection((prev) => ({ ...prev, chainId, strapId: chainId ? null : prev.strapId }));

  function toggleAddon(id: string) {
    setSelection((prev) => {
      const has = prev.addonIds.includes(id);
      return { ...prev, addonIds: has ? prev.addonIds.filter((a) => a !== id) : [...prev.addonIds, id] };
    });
  }

  // Position in the collection, for the editorial index mark.
  const ORDER = ["nova", "vault", "mini-luna", "loco"];
  const idx = ORDER.indexOf(bag.slug);
  const indexMark = idx >= 0 ? `${String(idx + 1).padStart(2, "0")} / ${String(ORDER.length).padStart(2, "0")}` : null;

  // Colour is the one control with a real visual response today; size, strap
  // and chain configure the ORDER but cannot yet change the picture. Grouping
  // them separately, and saying so once, is more honest than letting a
  // customer wait for a preview that will never come.
  const hasConfigOnly = Boolean(bag.sizes?.length || bag.straps?.length || bag.chains?.length || bag.handles?.length);

  return (
    <>
      <section className="pd-stage">
        {indexMark ? <p className="pd-index">{indexMark}</p> : null}
        {/* Product name as composition: oversized, sitting behind the object. */}
        <p className="pd-name" aria-hidden="true">{bag.name}</p>
        <div className="pd-object">
          <ProductGallery
            bag={bag}
            selection={selection}
            recolour={activePreview && preview ? { frame: preview.frame, colour: activePreview, profiles: preview.profiles, sourceColour: preview.sourceColour } : undefined}
            approved={approved}
          />
        </div>
        {/* Names exactly what the photograph shows. Colour is the one choice
            with a photographic answer, so saying so plainly is what keeps the
            image honest without a disclaimer. */}
        <p className="pd-caption">
          {activePreview && preview
            ? `Colour preview: ${activePreview.name}. Recoloured from a photograph of the ${preview.sourceColour} ${bag.name}, not a photograph of this colour.`
            : previewOnly
              ? `Digital colour preview in ${colourName}, not a photograph`
              : `Pictured in ${colourName}`}
        </p>
      </section>

      <section className="pd-buy">
        <div className="pd-buy-head">
          <h1 className="pd-h1">{bag.name}</h1>
          <PriceDisplay price={price} className="pd-price" />
        </div>
        <p className="pd-timing">
          Handmade to order{productionTimeLabel ? ` · ${productionTimeLabel}` : ""}
        </p>

        {/* TWO COLUMNS THAT BOTH CARRY SOMETHING.
            The left column held one control and the right held four, so at
            1440 the left ended after 198px while the right ran on to 804: a
            606px hole beside the options. It is a sticky panel, which is why
            it was allowed to be short, but the row fits inside a 900px
            viewport so the stickiness never engages and all a customer sees
            is the gap.
            Colour and Size sit together on the left now, and the two facts
            that were stranded below the Add to Bag bar come up beside the
            choice, where they answer the question a customer is actually
            asking while they configure. Nothing was written for this: both
            blocks already existed on the page. */}
        <div className="pd-opts">
          <div className="pd-opt-block pd-opt-choose">
            <ColourSelector
              showLabel
              bag={bag}
              colours={bag.colours}
              selectedId={activePreview ? "" : selection.colourId}
              onSelect={(colourId) => {
                setPreviewKey(null);
                setSelection((prev) => ({
                  ...prev,
                  colourId,
                  // Two-tone is the colourway itself, so the secondary zone
                  // follows the choice instead of being a separate control.
                  secondaryColourId: bag.colours.find((c) => c.id === colourId)?.isTwoTone ? colourId : null,
                }));
              }}
            />
            {preview?.colours.length ? (
              <div className="opt-group rc-previews">
                <p className="opt-label">Preview colours · not for sale</p>
                <div className="swatch-row" style={{ ["--n" as string]: preview.colours.length }}>
                  {preview.colours.map((c) => {
                    const on = c.key === previewKey;
                    // A source photograph only carries so much: Loco's dark
                    // cord cannot become a light colour convincingly, so those
                    // swatches are refused rather than shown badly.
                    const tooLight = preview.maxLightness !== undefined && srgbToLab(...hexToRgb(c.value))[0] > preview.maxLightness;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        className={`csw csw-named rc-swatch${on ? " is-on" : ""}${tooLight ? " is-off" : ""}`}
                        aria-label={`${c.name} (colour preview${tooLight ? ", no reliable preview for this bag" : ""})`}
                        aria-pressed={on}
                        disabled={tooLight}
                        title={tooLight ? "No reliable preview: this bag's photograph is too dark to show a colour this light" : undefined}
                        onClick={() => setPreviewKey(c.key)}
                      >
                        <span className="csw-name">
                          <span className="rc-dot" style={{ background: c.swatch }} aria-hidden="true" />
                          {c.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {bag.sizes ? (
              <SizeSelector
                sizes={bag.sizes}
                selectedId={selection.sizeId}
                onSelect={(sizeId) => setSelection((prev) => ({ ...prev, sizeId }))}
              />
            ) : null}
          </div>

          {hasConfigOnly ? (
            <div className="pd-opt-block">
              <p className="pd-opt-head">Details</p>
              {/* This read "crocheted in. The photograph shows the colour." —
                  a sentence with its subject missing, on every product page.
                  It names the chosen colourway now. */}
              {activePreview ? (
                <p className="pd-opt-note">
                  Showing a colour preview of {activePreview.name}, which is not available to order. Choose a
                  colour above to see its photograph and order it.
                </p>
              ) : (
                <p className="pd-opt-note">
                  Crocheted to order in {colourName || "your chosen colour"}.{" "}
                  {previewOnly
                    ? "Shown as a digital colour preview until it is photographed; the finished bag may differ slightly."
                    : "The photograph shows the colour you will receive."}
                </p>
              )}
              {bag.straps ? (
                <StrapHandleSelector label="Strap" kind="strap" bag={bag} options={bag.straps}
                  selectedId={selection.strapId} colourId={selection.colourId}
                  onSelect={pickStrap} />
              ) : null}
              {bag.handles ? (
                <StrapHandleSelector label="Handle" kind="handle" bag={bag} options={bag.handles}
                  selectedId={selection.handleId} colourId={selection.colourId}
                  onSelect={(handleId) => setSelection((prev) => ({ ...prev, handleId }))} />
              ) : null}
              {bag.chains ? (
                <StrapHandleSelector label="Chain" kind="chain" bag={bag} options={bag.chains}
                  selectedId={selection.chainId} colourId={selection.colourId}
                  onSelect={pickChain} />
              ) : null}
              {bag.straps?.length && bag.chains?.length ? (
                <p className="opt-note opt-note-either">Choose a strap or a chain, not both.</p>
              ) : null}
              {bag.addons ? (
                <AddonSelector addons={bag.addons} selectedIds={selection.addonIds}
                  colourId={selection.colourId} onToggle={toggleAddon} />
              ) : null}
            </div>
          ) : null}

          {/* Last in the DOM on purpose. On a phone the configurator is one
              column, so these read after the options, which is where facts
              belong; at 900 and up they are grid-placed into the foot of the
              choose column instead of stranded under the Add to Bag bar. */}
          <div className="pd-facts">
            <div>
              <p className="pd-fact-h">Material</p>
              <p>100% cotton yarn, hand-crocheted. Spot clean, air dry.</p>
            </div>
            <div>
              <p className="pd-fact-h">Made to order</p>
              <p>{productionTimeLabel ?? "Handmade to order. Timing on request."}</p>
            </div>
          </div>
        </div>

        <AddToCartInline label={actionLabel} price={money(price)} onClick={handleAdd} />
      </section>

      <AddToCartStickyBar price={price} label={actionLabel} onClick={handleAdd} />
    </>
  );
}
