// Arcubed Label — shared domain types.
// These shapes are the contract the UI is built against. The repository layer
// (src/lib/repository.ts) is responsible for mapping either Supabase rows or
// the mock fallback (src/lib/data.ts) into exactly this shape — components
// never know or care which source produced it.

export interface Colour {
  id: string;
  name: string;
  // Nullable: real Arcubed colourways currently have a confirmed NAME (from
  // client-supplied photography) but no confirmed hex swatch code. Never
  // invent an approximate hex here — every renderer that uses this must
  // treat null as "no colour data yet", not silently fall back to a guess.
  hex: string | null;
  isTwoTone: boolean;
  // Identifier for a real material/texture (yarn/crochet texture set) the 3D
  // viewer should use for this colour. Null for every real colour today —
  // the 3D viewer falls back to a flat hex tint (or the neutral placeholder
  // material if hex is also null).
  materialRef: string | null;
}

// A reference to one real (or development-placeholder) GLB asset — see
// src/lib/three/model-contract.ts for the node-naming contract every such
// file must follow, and public.model_assets for the DB table this is read
// from. Carried on Bag/StrapOption/ChainOption/HandleOption wherever a 3D
// asset exists for that part; absent everywhere for the 4 real products
// today, since no approved production geometry exists yet.
export interface Model3DRef {
  assetId: string;
  glbUrl: string;
  version: number;
}

export interface SizeOption {
  id: string;
  label: string;
  note: string;
  priceDelta: number;
}

export interface StrapOption {
  id: string;
  label: string;
  priceDelta: number;
  art: string;
  // Colour ids this option is available in. Omitted = available for every colour.
  // Kept optional since the current mock catalog has no real constraints yet —
  // this is the seam for real per-bag combination rules once Rand confirms them.
  compatibleWith?: string[];
  // 3D GLB reference for this strap, if one exists — see Model3DRef.
  model3D?: Model3DRef;
}

export interface HandleOption {
  id: string;
  label: string;
  priceDelta: number;
  art: string;
  compatibleWith?: string[];
  model3D?: Model3DRef;
}

// Same shape as StrapOption — a distinct customization category per the
// client's real spec ("straps" and "chains" are separate, both available on
// every product), not a strap art variant.
export interface ChainOption {
  id: string;
  label: string;
  priceDelta: number;
  art: string;
  compatibleWith?: string[];
  model3D?: Model3DRef;
}

export interface AddonOption {
  id: string;
  label: string;
  priceDelta: number;
  art: string;
  compatibleWith?: string[];
}

// One real product photo (public.product_images) — never fabricated; only
// ever populated from actual imported Arcubed photography. `colourId`/
// `strapHandleId` are nullable: null means "not tied to a specific
// colourway/strap-or-chain" (a general shape/silhouette shot), non-null
// means "this is what THAT exact colour (and optionally strap/chain) looks
// like" — the exact lookup `resolveProductImage` in pricing.ts uses to
// pick a real photo for the customer's current selection. `role`
// distinguishes the one image a product/shop card leads with from the
// rest of that colourway's gallery/detail shots.
export interface ProductImage {
  id: string;
  url: string;
  colourId: string | null;
  strapHandleId: string | null;
  sortOrder: number;
  role: "primary" | "gallery";
}

export interface Bag {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  basePrice: number;
  // Fully resolved, not just ids — this is what a real product_colours join
  // naturally returns, and it means leaf components (BagArt, CartLineItem,
  // etc.) never need a separate global colour lookup: whichever Bag they
  // already have in scope carries everything needed to resolve a colourId.
  colours: Colour[];
  // Real imported photography for this product — empty array for every
  // real product today (see docs/photo-asset-map.md: confirmed which Drive
  // folders map to which product/colourway, but no files have actually
  // been imported into product_images yet, since this environment has no
  // Google Drive access). Never populated with a guessed/generic image.
  images: ProductImage[];
  // Optional: the real Arcubed products currently have zero size options —
  // no size names have been confirmed yet, only the +5 JOD upgrade rule (see
  // option_upgrade_defaults). Every consumer must handle "no sizes" as a
  // normal, expected state, not an error.
  sizes?: SizeOption[];
  straps?: StrapOption[];
  handles?: HandleOption[];
  chains?: ChainOption[];
  addons?: AddonOption[];
  // The body GLB for this product (public.product_models, default/no-size
  // variant), if one has been linked. Undefined for all 4 real products
  // today — no approved production geometry exists yet, so the customizer
  // falls back to BagArt/photography. See src/components/three/.
  model3D?: Model3DRef;
}

// The customer's current in-progress choices on a Product/Customizer page —
// not yet committed to the cart.
export interface Selection {
  colourId: string;
  // Independent second material zone for two-tone products (Nova, Mini
  // Luna). Null for every non-two-tone bag and whenever no two-tone colour
  // is selected.
  secondaryColourId: string | null;
  // null when the bag has no size options at all (see Bag.sizes).
  sizeId: string | null;
  strapId: string | null;
  handleId: string | null;
  chainId: string | null;
  addonIds: string[];
}

// Store-wide facts, DB-backed (public.store_settings) rather than hardcoded
// per component — see repository.ts's getStoreSettings().
export interface StoreSettings {
  currencyCode: string;
  productionTimeLabel: string;
  productionTimeMinDays: number;
  productionTimeMaxDays: number;
  // Confirmed by Rand ("these would be delivered next day") — Ready for
  // Delivery's fulfillment time, distinct from made-to-order's.
  readyForDeliveryFulfillmentLabel: string;
}

// Return/exchange policy for one order type — DB-backed
// (public.return_policies), never hardcoded copy. isReturnable/
// returnWindowDays null = not yet confirmed by Rand; render policySummary
// as-is rather than inferring a rule. exceptionsSummary is always present
// and must always be shown — it's the legal/defect/damage/wrong-item
// exception path that applies regardless of isReturnable.
export interface ReturnPolicy {
  orderType: "custom" | "ready_for_delivery";
  isReturnable: boolean | null;
  returnWindowDays: number | null;
  policySummary: string;
  exceptionsSummary: string;
}

// One shipping zone, DB-backed (public.shipping_rules). amount is null +
// isQuoteRequired true for zones with no confirmed rate (international) —
// callers must never invent a number for those.
export interface ShippingRule {
  zoneKey: "amman" | "rest_of_jordan" | "international";
  label: string;
  amount: number | null;
  currencyCode: string;
  isQuoteRequired: boolean;
}

// The minimal, self-contained data BagArt needs to render a preview — no Bag
// or Colour lookup required. Computed once (from a live Bag + Selection) at
// the moment something is added to the cart, then stored on the CartItem
// itself. This is what lets the cart/cart drawer render correctly without
// ever re-fetching product data, and it's the same "preserve what was
// actually configured" principle the orders schema applies at the database
// level (see order_items.configuration_snapshot).
export interface BagRenderInput {
  name: string;
  // Null when the selected colour has no confirmed hex yet — BagArt renders
  // its own honest "no colour data" placeholder rather than guessing one.
  colourHex: string | null;
  // Second material zone, two-tone products only.
  secondaryColourHex?: string | null;
  strapArt?: string;
  handleArt?: string;
  chainArt?: string;
  addonArts?: string[];
}

// Human-readable snapshot of a cart line's configuration, captured at
// add-to-cart time. Powers the cart/cart-drawer display AND is the shape
// order_items.configuration_snapshot is built from when an order is placed —
// so "what the customer sees in their cart" and "what gets preserved on the
// order" are the same data, not two parallel representations that can drift.
// Which exact 3D asset versions were used for a configuration — preserved on
// the cart/order snapshot so it stays meaningful even if the underlying
// model_assets rows are later replaced/re-exported (a version bump).
export interface CartItem3DConfig {
  body: Model3DRef;
  strap?: Model3DRef;
  chain?: Model3DRef;
  handle?: Model3DRef;
}

export interface CartItemSnapshot {
  bagName: string;
  bagSlug: string;
  colourName: string;
  colourHex: string | null;
  secondaryColourName: string | null;
  secondaryColourHex: string | null;
  sizeLabel: string;
  strapLabel: string | null;
  strapArt: string | null;
  handleLabel: string | null;
  handleArt: string | null;
  chainLabel: string | null;
  chainArt: string | null;
  addons: { id: string; label: string; art: string; priceDelta: number }[];
  // Present only when this configuration was built using the real 3D
  // viewer (i.e. the bag had a model3D at add-to-cart time). Undefined for
  // every real product today.
  model3D?: CartItem3DConfig;
}

// A committed, priced line in the cart — the exact configuration is preserved
// (via `snapshot`) so "Edit" can reopen the customizer pre-filled with these
// exact values, and so the cart renders without depending on a live product
// fetch.
export interface CartItem {
  kind: "made_to_order";
  lineId: string;
  bagId: string;
  colourId: string;
  secondaryColourId: string | null;
  sizeId: string | null;
  strapId: string | null;
  handleId: string | null;
  chainId: string | null;
  addonIds: string[];
  qty: number;
  unitPrice: number;
  snapshot: CartItemSnapshot;
}

// ------------------------------------------------------------------
// Ready for Delivery — Rand's in-stock, already-made bags. A separate
// storefront experience from the made-to-order customizer (see
// docs/ready-for-delivery.md): a fixed physical item with a fixed
// configuration, not a live selection, so it doesn't reuse Bag/Selection.
// ------------------------------------------------------------------

export interface ReadyForDeliveryImage {
  id: string;
  url: string;
}

export interface ReadyForDeliveryItem {
  id: string;
  productId: string;
  productName: string;
  productSlug: string;
  title: string;
  colourName: string | null;
  secondaryColourName: string | null;
  sizeLabel: string | null;
  strapLabel: string | null;
  chainLabel: string | null;
  // Human override/summary — if null, compose a description from the
  // colour/size/strap/chain fields above instead of leaving it blank.
  configurationDescription: string | null;
  price: number;
  quantityAvailable: number;
  images: ReadyForDeliveryImage[];
}

// Snapshot captured once, at add-to-cart time — same "preserve what was
// actually there" principle as CartItemSnapshot, so a later change to the
// ready_for_delivery_items row (or its price/quantity) never rewrites what
// an existing cart/order shows.
export interface ReadyForDeliverySnapshot {
  itemTitle: string;
  productName: string;
  colourName: string | null;
  secondaryColourName: string | null;
  sizeLabel: string | null;
  strapLabel: string | null;
  chainLabel: string | null;
  configurationDescription: string | null;
  imageUrl: string | null;
  fulfillmentLabel: string;
}

export interface ReadyForDeliveryCartItem {
  kind: "ready_for_delivery";
  lineId: string;
  itemId: string;
  qty: number;
  unitPrice: number;
  snapshot: ReadyForDeliverySnapshot;
}

// One cart line is EITHER a made-to-order customizer configuration OR a
// fixed ready-for-delivery item — `kind` discriminates. Both share
// lineId/qty/unitPrice, so cart-total math works over the union without
// branching (see cart-context.tsx).
export type CartLine = CartItem | ReadyForDeliveryCartItem;
