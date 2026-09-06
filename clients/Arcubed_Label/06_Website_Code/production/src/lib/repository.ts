import "server-only";

// Arcubed Label — the ONE place that decides where product data comes from.
// Every page/component asks THIS module for data, never Supabase or the mock
// module directly (see components/pages — none of them import from
// ./data.ts or ./supabase/* anymore).
//
// Production vs. development behavior is deliberately different:
//   - Development: missing config OR a Supabase read failure both fall back
//     to MOCK_BAGS/MOCK_COLOURS (with a console warning), so local dev keeps
//     working without a live project or a live network.
//   - Production: missing config OR a Supabase read failure both THROW
//     CatalogUnavailableError instead. Production must never silently show
//     fake products — see app/error.tsx / app/shop/error.tsx /
//     app/product/[slug]/error.tsx, which catch this and render a clean,
//     non-technical empty-state instead of Next's default error overlay.
//
// STATUS (2026-09-02): the live database (project ref fnswiyxjbsabomktqizr)
// now holds Rand's real catalog — Nova, Vault, Mini Luna, Loco — inserted
// via supabase/migrations/20260902120200_seed_real_arcubed_catalog.sql. The
// old mock products (Rosa Tote, Luna Crossbody, Mira Mini Bag, Coco Market
// Bag) are deactivated (active=false), not deleted, once the real data was
// verified end-to-end. supabase/seed.sql's dev fixture is untouched and
// still used for local development without a live DB — see ./data.ts.

import { createClient } from "./supabase/server";
import { MOCK_BAGS, MOCK_COLOURS, MOCK_STORE_SETTINGS, MOCK_SHIPPING_RULES, MOCK_RETURN_POLICIES, getMockBag } from "./data";
import { logCatalogError, logCatalogWarning } from "./logger";
import type {
  Bag,
  Colour,
  SizeOption,
  StrapOption,
  HandleOption,
  ChainOption,
  AddonOption,
  ProductImage,
  StoreSettings,
  ShippingRule,
  ReturnPolicy,
  ReadyForDeliveryItem,
} from "./types";

const isProduction = process.env.NODE_ENV === "production";

// Thrown when the real catalog can't be read and — because we're in
// production — mock data is not an acceptable substitute. Caught by each
// route's error.tsx boundary and rendered as a plain, non-technical
// storefront message (see components/CatalogErrorState.tsx).
export class CatalogUnavailableError extends Error {
  constructor(message = "The shop is temporarily unavailable.") {
    super(message);
    this.name = "CatalogUnavailableError";
  }
}

function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

// ------------------------------------------------------------------
// PLACEHOLDER-ART MAPPING — temporary, deleted once real photography exists.
//
// The database intentionally has no "art" column: which procedural SVG shape
// to draw is not real product data Rand would ever provide, so it doesn't
// belong in the schema. While the placeholder renderer (BagArt.tsx) is still
// in use, this best-effort name match picks a reasonable shape key from the
// strap/handle/chain/addon's real `name`. Once real layered photography
// (see product_images.colour_id / .strap_handle_id) replaces BagArt for a
// given colour, this function and every "art" field on these types goes away
// for that colour.
// ------------------------------------------------------------------
function inferArtKey(name: string, type: "strap" | "handle" | "chain" | "addon"): string {
  const n = name.toLowerCase();
  if (type === "strap" || type === "chain") {
    if (n.includes("braid")) return "braided";
    if (n.includes("chain")) return "chain";
    return type === "chain" ? "chain" : "woven";
  }
  if (type === "handle") {
    if (n.includes("long")) return "handleLong";
    return "handleShort";
  }
  // addon
  if (n.includes("charm")) return "charm";
  if (n.includes("tassel")) return "tassel";
  if (n.includes("pouch")) return "pouch";
  if (n.includes("monogram")) return "monogram";
  return "";
}

// ------------------------------------------------------------------
// Supabase row shapes (subset of columns actually selected) + mapping to the
// frontend's Bag type.
// ------------------------------------------------------------------

export interface ProductRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  base_price: number;
  product_colours: {
    price_delta: number;
    active: boolean;
    sort_order: number;
    colours: {
      id: string;
      name: string;
      hex_value: string | null;
      is_two_tone: boolean;
      material_ref: string | null;
      active: boolean;
    } | null;
  }[];
  product_sizes: {
    price_delta: number;
    note: string | null;
    active: boolean;
    sort_order: number;
    sizes: { id: string; name: string; active: boolean } | null;
  }[];
  product_straps_handles: {
    price_delta: number;
    active: boolean;
    sort_order: number;
    compatible_colour_ids: string[] | null;
    straps_handles: {
      id: string;
      name: string;
      type: "strap" | "handle" | "chain";
      active: boolean;
      model_assets: { id: string; glb_url: string; version: number } | null;
    } | null;
  }[];
  product_addons: {
    price_delta: number;
    active: boolean;
    sort_order: number;
    compatible_colour_ids: string[] | null;
    addons: { id: string; name: string; active: boolean } | null;
  }[];
  product_images: {
    id: string;
    image_url: string;
    image_type: string;
    sort_order: number;
    colour_id: string | null;
    strap_handle_id: string | null;
  }[];
}

function toModel3DRef(asset: { id: string; glb_url: string; version: number } | null | undefined) {
  return asset ? { assetId: asset.id, glbUrl: asset.glb_url, version: asset.version } : undefined;
}

export function mapRowToBag(row: ProductRow): Bag {
  const colours: Colour[] = row.product_colours
    .filter((pc) => pc.active && pc.colours?.active)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((pc) => ({
      id: pc.colours!.id,
      name: pc.colours!.name,
      hex: pc.colours!.hex_value,
      isTwoTone: pc.colours!.is_two_tone,
      materialRef: pc.colours!.material_ref,
    }));

  const sizes: SizeOption[] = row.product_sizes
    .filter((ps) => ps.active && ps.sizes?.active)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((ps) => ({
      id: ps.sizes!.id,
      label: ps.sizes!.name,
      note: ps.note ?? "",
      priceDelta: ps.price_delta,
    }));

  const strapsHandles = row.product_straps_handles.filter((psh) => psh.active && psh.straps_handles?.active);
  const straps: StrapOption[] = strapsHandles
    .filter((psh) => psh.straps_handles!.type === "strap")
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((psh) => ({
      id: psh.straps_handles!.id,
      label: psh.straps_handles!.name,
      priceDelta: psh.price_delta,
      art: inferArtKey(psh.straps_handles!.name, "strap"),
      compatibleWith: psh.compatible_colour_ids ?? undefined,
      model3D: toModel3DRef(psh.straps_handles!.model_assets),
    }));
  const handles: HandleOption[] = strapsHandles
    .filter((psh) => psh.straps_handles!.type === "handle")
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((psh) => ({
      id: psh.straps_handles!.id,
      label: psh.straps_handles!.name,
      priceDelta: psh.price_delta,
      art: inferArtKey(psh.straps_handles!.name, "handle"),
      compatibleWith: psh.compatible_colour_ids ?? undefined,
      model3D: toModel3DRef(psh.straps_handles!.model_assets),
    }));
  const chains: ChainOption[] = strapsHandles
    .filter((psh) => psh.straps_handles!.type === "chain")
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((psh) => ({
      id: psh.straps_handles!.id,
      label: psh.straps_handles!.name,
      priceDelta: psh.price_delta,
      art: inferArtKey(psh.straps_handles!.name, "chain"),
      compatibleWith: psh.compatible_colour_ids ?? undefined,
      model3D: toModel3DRef(psh.straps_handles!.model_assets),
    }));

  const addons: AddonOption[] = row.product_addons
    .filter((pa) => pa.active && pa.addons?.active)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((pa) => ({
      id: pa.addons!.id,
      label: pa.addons!.name,
      priceDelta: pa.price_delta,
      art: inferArtKey(pa.addons!.name, "addon"),
      compatibleWith: pa.compatible_colour_ids ?? undefined,
    }));

  // Real photography only — never invented. image_type is a free-text
  // column (no DB check constraint); "primary"/"gallery" is this app's own
  // convention, applied on write (see docs/ready-for-delivery.md's sibling
  // note for the equivalent RFD-image convention). Any other value quietly
  // falls back to "gallery" rather than throwing — a data-entry typo in
  // Supabase should never break a product page.
  const images: ProductImage[] = row.product_images
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((pi) => ({
      id: pi.id,
      url: pi.image_url,
      colourId: pi.colour_id,
      strapHandleId: pi.strap_handle_id,
      sortOrder: pi.sort_order,
      role: pi.image_type === "primary" ? "primary" : "gallery",
    }));

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.description ?? "",
    basePrice: row.base_price,
    colours,
    images,
    sizes: sizes.length ? sizes : undefined,
    straps: straps.length ? straps : undefined,
    handles: handles.length ? handles : undefined,
    chains: chains.length ? chains : undefined,
    addons: addons.length ? addons : undefined,
  };
}

export const PRODUCT_SELECT = `
  id, slug, name, description, base_price,
  product_colours ( price_delta, active, sort_order, colours ( id, name, hex_value, is_two_tone, material_ref, active ) ),
  product_sizes ( price_delta, note, active, sort_order, sizes ( id, name, active ) ),
  product_straps_handles ( price_delta, active, sort_order, compatible_colour_ids, straps_handles ( id, name, type, active, model_assets ( id, glb_url, version ) ) ),
  product_addons ( price_delta, active, sort_order, compatible_colour_ids, addons ( id, name, active ) ),
  product_images ( id, image_url, image_type, sort_order, colour_id, strap_handle_id )
`;

// ------------------------------------------------------------------
// 3D body models — a separate, lightweight query rather than folded into
// PRODUCT_SELECT above: product_models can have multiple rows per product
// (default + per-size variants) and mapRowToBag stays a pure sync function
// used by orders.ts's pricing path too, which has no use for 3D data.
// Merged onto each Bag's `model3D` after the main query. Empty for all 4
// real products today — no product_models rows exist for them yet.
// ------------------------------------------------------------------
async function getDefaultBodyModelsByProductId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  productIds: string[]
): Promise<Map<string, ReturnType<typeof toModel3DRef>>> {
  if (productIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("product_models")
    .select("product_id, model_assets ( id, glb_url, version )")
    .in("product_id", productIds)
    .is("size_id", null)
    .eq("active", true);

  if (error) {
    logCatalogError(error.message, { operation: "getDefaultBodyModelsByProductId" });
    return new Map();
  }

  const map = new Map<string, ReturnType<typeof toModel3DRef>>();
  for (const row of data ?? []) {
    const ref = toModel3DRef(row.model_assets as unknown as { id: string; glb_url: string; version: number } | null);
    if (ref) map.set(row.product_id, ref);
  }
  return map;
}

// ------------------------------------------------------------------
// Public repository API — this is what pages/components call.
// ------------------------------------------------------------------

export async function getActiveBags(): Promise<Bag[]> {
  if (!isSupabaseConfigured()) {
    if (isProduction) {
      logCatalogError("Supabase not configured in production.", { operation: "getActiveBags" });
      throw new CatalogUnavailableError();
    }
    logCatalogWarning("Supabase not configured — using MOCK_BAGS (development fallback only).");
    return MOCK_BAGS;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    logCatalogError(error.message, { operation: "getActiveBags" });
    if (isProduction) {
      throw new CatalogUnavailableError();
    }
    logCatalogWarning("Falling back to MOCK_BAGS after a Supabase read failure (development only).");
    return MOCK_BAGS;
  }
  const bags = (data as unknown as ProductRow[]).map(mapRowToBag);
  const bodyModels = await getDefaultBodyModelsByProductId(supabase, bags.map((b) => b.id));
  return bags.map((b) => (bodyModels.has(b.id) ? { ...b, model3D: bodyModels.get(b.id) } : b));
}

export async function getBagBySlug(slug: string): Promise<Bag | null> {
  if (!isSupabaseConfigured()) {
    if (isProduction) {
      logCatalogError("Supabase not configured in production.", { operation: "getBagBySlug", slug });
      throw new CatalogUnavailableError();
    }
    logCatalogWarning("Supabase not configured — using getMockBag (development fallback only).", { slug });
    return getMockBag(slug);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    logCatalogError(error.message, { operation: "getBagBySlug", slug });
    if (isProduction) {
      throw new CatalogUnavailableError();
    }
    logCatalogWarning("Falling back to getMockBag after a Supabase read failure (development only).", { slug });
    return getMockBag(slug);
  }
  if (!data) return null;
  const bag = mapRowToBag(data as unknown as ProductRow);
  const bodyModels = await getDefaultBodyModelsByProductId(supabase, [bag.id]);
  const model3D = bodyModels.get(bag.id);
  return model3D ? { ...bag, model3D } : bag;
}

// Used only by the home page's "Make it yours" teaser swatches — the one
// place that legitimately needs the whole shared colour palette rather than
// a single product's resolved colours. Lower stakes than a product listing
// (it's decorative, not "the shop"), so on failure in production this
// degrades to an empty palette rather than throwing and taking down the
// whole home page over a swatch row.
export async function getActiveColours(): Promise<Colour[]> {
  if (!isSupabaseConfigured()) {
    if (isProduction) {
      logCatalogError("Supabase not configured in production.", { operation: "getActiveColours" });
      return [];
    }
    return MOCK_COLOURS;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("colours")
    .select("id, name, hex_value, is_two_tone, material_ref")
    .eq("active", true);

  if (error) {
    logCatalogError(error.message, { operation: "getActiveColours" });
    if (isProduction) {
      return [];
    }
    logCatalogWarning("Falling back to MOCK_COLOURS after a Supabase read failure (development only).");
    return MOCK_COLOURS;
  }
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    hex: c.hex_value,
    isTwoTone: c.is_two_tone,
    materialRef: c.material_ref,
  }));
}

// Store-wide settings (currency, production lead time) — see
// public.store_settings. Informational/display use across several pages
// (FAQ, cart, customizer), so — like getActiveColours — a production failure
// degrades to null rather than taking down the page; callers show a generic
// "contact us" fallback rather than an invented number.
export async function getStoreSettings(): Promise<StoreSettings | null> {
  if (!isSupabaseConfigured()) {
    if (isProduction) {
      logCatalogError("Supabase not configured in production.", { operation: "getStoreSettings" });
      return null;
    }
    return MOCK_STORE_SETTINGS;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("store_settings")
    .select(
      "currency_code, production_time_label, production_time_min_days, production_time_max_days, ready_for_delivery_fulfillment_label"
    )
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) {
    if (error) logCatalogError(error.message, { operation: "getStoreSettings" });
    if (isProduction) return null;
    logCatalogWarning("Falling back to MOCK_STORE_SETTINGS after a Supabase read failure (development only).");
    return MOCK_STORE_SETTINGS;
  }
  return {
    currencyCode: data.currency_code,
    productionTimeLabel: data.production_time_label,
    productionTimeMinDays: data.production_time_min_days,
    productionTimeMaxDays: data.production_time_max_days,
    readyForDeliveryFulfillmentLabel: data.ready_for_delivery_fulfillment_label,
  };
}

// Shipping zones — see public.shipping_rules. Used both for display (cart
// page) and, via orders.ts, as the SERVER-SIDE AUTHORITATIVE amount for order
// totals. orders.ts is strict about requiring a real match before creating an
// order; this function itself just degrades to [] on failure like the other
// display-oriented reads above.
export async function getShippingRules(): Promise<ShippingRule[]> {
  if (!isSupabaseConfigured()) {
    if (isProduction) {
      logCatalogError("Supabase not configured in production.", { operation: "getShippingRules" });
      return [];
    }
    return MOCK_SHIPPING_RULES;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shipping_rules")
    .select("zone_key, label, amount, currency_code, is_quote_required")
    .order("sort_order", { ascending: true });

  if (error) {
    logCatalogError(error.message, { operation: "getShippingRules" });
    if (isProduction) return [];
    logCatalogWarning("Falling back to MOCK_SHIPPING_RULES after a Supabase read failure (development only).");
    return MOCK_SHIPPING_RULES;
  }
  return (data ?? []).map((r) => ({
    zoneKey: r.zone_key as ShippingRule["zoneKey"],
    label: r.label,
    amount: r.amount,
    currencyCode: r.currency_code,
    isQuoteRequired: r.is_quote_required,
  }));
}

// Return/exchange policy per order type — see public.return_policies.
// Display-only, so — like colours/settings/shipping — a production failure
// degrades to [] rather than taking down the page it's shown on (FAQ).
export async function getReturnPolicies(): Promise<ReturnPolicy[]> {
  if (!isSupabaseConfigured()) {
    if (isProduction) {
      logCatalogError("Supabase not configured in production.", { operation: "getReturnPolicies" });
      return [];
    }
    return MOCK_RETURN_POLICIES;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("return_policies")
    .select("order_type, is_returnable, return_window_days, policy_summary, exceptions_summary");

  if (error) {
    logCatalogError(error.message, { operation: "getReturnPolicies" });
    if (isProduction) return [];
    logCatalogWarning("Falling back to MOCK_RETURN_POLICIES after a Supabase read failure (development only).");
    return MOCK_RETURN_POLICIES;
  }
  return (data ?? []).map((r) => ({
    orderType: r.order_type as ReturnPolicy["orderType"],
    isReturnable: r.is_returnable,
    returnWindowDays: r.return_window_days,
    policySummary: r.policy_summary,
    exceptionsSummary: r.exceptions_summary,
  }));
}

// ------------------------------------------------------------------
// Ready for Delivery — Rand's in-stock, already-made bags. Deliberately
// separate from getActiveBags()/getBagBySlug() above: a ready item is a
// fixed physical bag (see public.ready_for_delivery_items), not a live
// customizer configuration, so it doesn't go through mapRowToBag/Bag at
// all. A production read failure throws CatalogUnavailableError, same
// severity as the made-to-order shop — "the shop is unavailable" is the
// honest state, not an empty/silently-missing Ready for Delivery section.
// ------------------------------------------------------------------

const READY_FOR_DELIVERY_SELECT = `
  id, product_id, title, configuration_description, price, quantity_available, sort_order,
  products ( name, slug ),
  colours:colour_id ( name ),
  secondary_colours:secondary_colour_id ( name ),
  sizes ( name ),
  straps:strap_id ( name ),
  chains:chain_id ( name ),
  ready_for_delivery_item_images ( id, image_url, sort_order )
`;

interface ReadyForDeliveryRow {
  id: string;
  product_id: string;
  title: string;
  configuration_description: string | null;
  price: number;
  quantity_available: number;
  sort_order: number;
  products: { name: string; slug: string } | null;
  colours: { name: string } | null;
  secondary_colours: { name: string } | null;
  sizes: { name: string } | null;
  straps: { name: string } | null;
  chains: { name: string } | null;
  ready_for_delivery_item_images: { id: string; image_url: string; sort_order: number }[];
}

function mapRowToReadyForDeliveryItem(row: ReadyForDeliveryRow): ReadyForDeliveryItem {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.products?.name ?? "",
    productSlug: row.products?.slug ?? "",
    title: row.title,
    colourName: row.colours?.name ?? null,
    secondaryColourName: row.secondary_colours?.name ?? null,
    sizeLabel: row.sizes?.name ?? null,
    strapLabel: row.straps?.name ?? null,
    chainLabel: row.chains?.name ?? null,
    configurationDescription: row.configuration_description,
    price: row.price,
    quantityAvailable: row.quantity_available,
    images: [...row.ready_for_delivery_item_images]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((img) => ({ id: img.id, url: img.image_url })),
  };
}

export async function getReadyForDeliveryItems(): Promise<ReadyForDeliveryItem[]> {
  if (!isSupabaseConfigured()) {
    if (isProduction) {
      logCatalogError("Supabase not configured in production.", { operation: "getReadyForDeliveryItems" });
      throw new CatalogUnavailableError();
    }
    logCatalogWarning("Supabase not configured — Ready for Delivery has no dev fixture, returning empty (development only).");
    return [];
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ready_for_delivery_items")
    .select(READY_FOR_DELIVERY_SELECT)
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    logCatalogError(error.message, { operation: "getReadyForDeliveryItems" });
    if (isProduction) throw new CatalogUnavailableError();
    return [];
  }
  return (data as unknown as ReadyForDeliveryRow[]).map(mapRowToReadyForDeliveryItem);
}

export async function getReadyForDeliveryItemById(id: string): Promise<ReadyForDeliveryItem | null> {
  if (!isSupabaseConfigured()) {
    if (isProduction) {
      logCatalogError("Supabase not configured in production.", { operation: "getReadyForDeliveryItemById", id });
      throw new CatalogUnavailableError();
    }
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ready_for_delivery_items")
    .select(READY_FOR_DELIVERY_SELECT)
    .eq("id", id)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    logCatalogError(error.message, { operation: "getReadyForDeliveryItemById", id });
    if (isProduction) throw new CatalogUnavailableError();
    return null;
  }
  return data ? mapRowToReadyForDeliveryItem(data as unknown as ReadyForDeliveryRow) : null;
}
