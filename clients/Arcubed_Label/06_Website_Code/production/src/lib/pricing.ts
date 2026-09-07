// Arcubed Label — pricing + configuration-snapshot helpers, ported from the
// prototype (prototype/js/app.js). totalPrice = basePrice + sum(selected
// option priceDeltas), recomputed on every change, same rule the approved
// architecture doc specifies.

import type { Bag, Selection, CartItemSnapshot, BagRenderInput, ProductImage, ReadyForDeliveryItem, ReadyForDeliverySnapshot } from "./types";
import { formatMoney } from "./site-settings";

// Ready for Delivery items have a fixed price and a fixed configuration —
// no computeUnitPrice/Selection involved, just a direct snapshot of the
// item as it existed at add-to-cart time (see ReadyForDeliverySnapshot).
export function buildReadyForDeliverySnapshot(
  item: ReadyForDeliveryItem,
  fulfillmentLabel: string
): ReadyForDeliverySnapshot {
  return {
    itemTitle: item.title,
    productName: item.productName,
    colourName: item.colourName,
    secondaryColourName: item.secondaryColourName,
    sizeLabel: item.sizeLabel,
    strapLabel: item.strapLabel,
    chainLabel: item.chainLabel,
    configurationDescription: item.configurationDescription,
    imageUrl: item.images[0]?.url ?? null,
    fulfillmentLabel,
  };
}

export function defaultSelectionFor(bag: Bag, initialColourId?: string | null): Selection {
  // A colour carried in the URL wins. Without this every Shop tile opened on
  // colours[0]: clicking Silver Mini Luna opened Red.
  const colour = bag.colours.find((c) => c.id === initialColourId) ?? bag.colours[0];
  return {
    colourId: colour.id,
    // Two-tone is a COLOURWAY, chosen in the colour row and backed by its own
    // photography (Mini Luna Silver & Gold is DSC04870). The secondary id is
    // derived from that choice rather than being a second control the
    // customer has to find — there used to be an "optional two-tone" selector
    // that set this and changed nothing on screen.
    secondaryColourId: colour.isTwoTone ? colour.id : null,
    // Size is a required choice, so the first (Regular, +0) is pre-selected.
    sizeId: bag.sizes && bag.sizes.length ? bag.sizes[0].id : null,
    // Straps, handles and chains are PAID UPGRADES (+5 JOD each), so none is
    // pre-selected — same opt-in rule as the secondary colour above.
    //
    // These previously defaulted to options[0], which silently added +5 for a
    // strap and +5 for a chain: Nova opened at JOD 65 instead of its real
    // JOD 55 base price, and a customer who pressed "Add to Bag" straight away
    // was charged for two extras they never chose. Caught by loading the real
    // page, not by any type or build check.
    strapId: null,
    handleId: null,
    chainId: null,
    addonIds: [],
  };
}

export function computeUnitPrice(bag: Bag, sel: Selection): number {
  let total = bag.basePrice;
  const size = bag.sizes?.find((s) => s.id === sel.sizeId);
  if (size) total += size.priceDelta;
  const strap = bag.straps?.find((s) => s.id === sel.strapId);
  if (strap) total += strap.priceDelta;
  const handle = bag.handles?.find((h) => h.id === sel.handleId);
  if (handle) total += handle.priceDelta;
  const chain = bag.chains?.find((c) => c.id === sel.chainId);
  if (chain) total += chain.priceDelta;
  for (const id of sel.addonIds) {
    const addon = bag.addons?.find((a) => a.id === id);
    if (addon) total += addon.priceDelta;
  }
  return total;
}

// Built once, at the moment a configuration is added to the cart — everything
// the cart/cart-drawer/order need to display and preserve this exact line,
// independent of whatever the live product looks like later.
export function buildCartSnapshot(bag: Bag, sel: Selection): CartItemSnapshot {
  const colour = bag.colours.find((c) => c.id === sel.colourId) ?? bag.colours[0];
  // Only a DIFFERENT secondary colour is worth recording. Two-tone is now the
  // colourway itself, so primary and secondary are the same row and printing
  // both gave lines like "Silver & Gold · Silver & Gold two-tone".
  const secondaryColour = sel.secondaryColourId && sel.secondaryColourId !== sel.colourId
    ? bag.colours.find((c) => c.id === sel.secondaryColourId)
    : undefined;
  const size = bag.sizes?.find((s) => s.id === sel.sizeId);
  const strap = bag.straps?.find((s) => s.id === sel.strapId);
  const handle = bag.handles?.find((h) => h.id === sel.handleId);
  const chain = bag.chains?.find((c) => c.id === sel.chainId);
  const addons = sel.addonIds
    .map((id) => bag.addons?.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a))
    .map((a) => ({ id: a.id, label: a.label, art: a.art, priceDelta: a.priceDelta }));

  // Only present when the bag actually has a real 3D body asset — captures
  // the exact asset versions used, so the snapshot stays meaningful even if
  // model_assets rows are later replaced. See CartItem3DConfig.
  const model3D = bag.model3D
    ? {
        body: bag.model3D,
        strap: strap?.model3D,
        chain: chain?.model3D,
        handle: handle?.model3D,
      }
    : undefined;

  return {
    bagName: bag.name,
    bagSlug: bag.slug,
    colourName: colour.name,
    colourHex: colour.hex,
    secondaryColourName: secondaryColour?.name ?? null,
    secondaryColourHex: secondaryColour?.hex ?? null,
    sizeLabel: size?.label ?? "",
    strapLabel: strap?.label ?? null,
    strapArt: strap?.art ?? null,
    handleLabel: handle?.label ?? null,
    handleArt: handle?.art ?? null,
    chainLabel: chain?.label ?? null,
    chainArt: chain?.art ?? null,
    addons,
    model3D,
  };
}

// Readable tags for the cart/cart-drawer ("Colour: Terracotta · Size: Medium
// · Strap: Braided · +Gold Charm") — reads entirely from the snapshot, no
// live product fetch needed.
export function snapshotSummary(snapshot: CartItemSnapshot): string[] {
  const parts: string[] = [`Colour: ${snapshot.colourName}`];
  if (snapshot.secondaryColourName) parts.push(`Secondary: ${snapshot.secondaryColourName}`);
  if (snapshot.sizeLabel) parts.push(`Size: ${snapshot.sizeLabel}`);
  if (snapshot.strapLabel) parts.push(`Strap: ${snapshot.strapLabel}`);
  if (snapshot.handleLabel) parts.push(`Handle: ${snapshot.handleLabel}`);
  if (snapshot.chainLabel) parts.push(`Chain: ${snapshot.chainLabel}`);
  for (const a of snapshot.addons) parts.push(`+${a.label}`);
  return parts;
}

// BagArt render input from a live Bag + in-progress Selection (Customizer,
// product cards, home page).
export function toRenderInput(bag: Bag, sel: Selection): BagRenderInput {
  const colour = bag.colours.find((c) => c.id === sel.colourId) ?? bag.colours[0];
  const secondaryColour = sel.secondaryColourId
    ? bag.colours.find((c) => c.id === sel.secondaryColourId)
    : undefined;
  const strap = bag.straps?.find((s) => s.id === sel.strapId);
  const handle = bag.handles?.find((h) => h.id === sel.handleId);
  const chain = bag.chains?.find((c) => c.id === sel.chainId);
  const addonArts = sel.addonIds
    .map((id) => bag.addons?.find((a) => a.id === id)?.art)
    .filter((a): a is string => Boolean(a));
  return {
    name: bag.name,
    colourHex: colour.hex,
    secondaryColourHex: secondaryColour?.hex ?? null,
    strapArt: strap?.art,
    handleArt: handle?.art,
    chainArt: chain?.art,
    addonArts,
  };
}

// Real-photo lookup for the customer's current colour (+ strap/chain)
// selection — the middle tier of the REAL-PHOTO FALLBACK RULE (production
// 3D → real photography → BagArt), see
// clients/Arcubed_Label/05_Design_Inspiration/motion-and-art-direction.md.
// Never fabricates a match: if no real photo exists for this exact
// colour, the caller falls through to BagArt — that's correct behaviour,
// not a bug, until real photography is imported for that colourway.
//
// Preference order: an image tied to BOTH this colour AND the selected
// strap/chain (a shot of that exact configuration) beats a general shot of
// just the colour (strap_handle_id null) — matching product_images'
// nullable colour_id/strap_handle_id design. Falls back to colour-only
// images if no exact strap/chain-specific shot exists.
export function resolveProductImages(bag: Bag, sel: Selection): ProductImage[] {
  if (bag.images.length === 0) return [];
  const strapOrChainId = sel.strapId ?? sel.chainId ?? null;

  const exact = bag.images.filter(
    (img) => img.colourId === sel.colourId && strapOrChainId !== null && img.strapHandleId === strapOrChainId
  );
  if (exact.length > 0) return sortImages(exact);

  const colourOnly = bag.images.filter((img) => img.colourId === sel.colourId && img.strapHandleId === null);
  if (colourOnly.length > 0) return sortImages(colourOnly);

  return [];
}

function sortImages(images: ProductImage[]): ProductImage[] {
  return [...images].sort((a, b) => {
    if (a.role !== b.role) return a.role === "primary" ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });
}

// The one image a product/shop card leads with — the bag's own default
// selection's primary real photo, if one exists. Used where there's no
// live Selection to react to (Shop grid, Home featured cards): always
// resolved against the bag's OWN default colour, never a guess.
export function resolvePrimaryImage(bag: Bag): ProductImage | null {
  const images = resolveProductImages(bag, defaultSelectionFor(bag));
  return images[0] ?? null;
}

// BagArt render input from a cart line's stored snapshot (cart, cart drawer)
// — no live Bag needed at all.
export function snapshotToRenderInput(snapshot: CartItemSnapshot): BagRenderInput {
  return {
    name: snapshot.bagName,
    colourHex: snapshot.colourHex,
    secondaryColourHex: snapshot.secondaryColourHex,
    strapArt: snapshot.strapArt ?? undefined,
    handleArt: snapshot.handleArt ?? undefined,
    chainArt: snapshot.chainArt ?? undefined,
    addonArts: snapshot.addons.map((a) => a.art),
  };
}

// Delegates to the centralized, currency-aware formatter in site-settings.ts
// rather than a hardcoded "$" prefix — see that file for why the currency
// code itself is still unresolved.
export function money(n: number): string {
  return formatMoney(n);
}
