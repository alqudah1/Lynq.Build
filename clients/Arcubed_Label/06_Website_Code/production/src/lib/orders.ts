import "server-only";

// Arcubed Label — server-side order creation. This is architecture only: it
// is NOT wired into the storefront yet (the Cart page's "Checkout" button
// still shows the placeholder toast). No Stripe, no real checkout flow.
//
// Deliberately a plain server-only function, NOT a `"use server"` Server
// Action — a Server Action becomes an RPC endpoint reachable from the client
// the moment it exists, regardless of whether any UI currently calls it.
// This gets wired behind an actual checkout flow later (validated cart ->
// Stripe payment -> confirmed order), at which point a thin Server Action
// wrapper can call this function after payment is confirmed.
//
// The one rule this function exists to enforce: NEVER trust a client-sent
// price. Every line is re-priced from the database, using the exact same
// mapRowToBag/computeUnitPrice/buildCartSnapshot logic the storefront uses —
// so "what the customer saw" and "what they're charged" come from the same
// source of truth, not two implementations that can drift.

import { createAdminClient } from "./supabase/admin";
import { PRODUCT_SELECT, mapRowToBag, getShippingRules, getStoreSettings, type ProductRow } from "./repository";
import { computeUnitPrice, buildCartSnapshot, buildReadyForDeliverySnapshot } from "./pricing";
import { logOrderError } from "./logger";
import type { Selection, ShippingRule } from "./types";
import type { Json } from "./supabase/types";

export interface MadeToOrderInputLine {
  kind: "made_to_order";
  productId: string;
  colourId: string;
  // Two-tone products only (Nova, Mini Luna) — must be one of that bag's
  // is_two_tone colours if present.
  secondaryColourId?: string | null;
  // Optional: only required when the product actually offers size options
  // (see Bag.sizes) — the real Arcubed catalog currently has none.
  sizeId?: string | null;
  strapId?: string | null;
  handleId?: string | null;
  chainId?: string | null;
  addonIds?: string[];
  quantity: number;
}

export interface ReadyForDeliveryInputLine {
  kind: "ready_for_delivery";
  itemId: string;
  quantity: number;
}

export type OrderInputLine = MadeToOrderInputLine | ReadyForDeliveryInputLine;

export interface CreateOrderInput {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  shippingZone: ShippingRule["zoneKey"];
  shippingAddress?: Record<string, unknown>;
  notes?: string;
  items: OrderInputLine[];
}

export type CreateOrderResult =
  | { ok: true; orderId: string; orderNumber: string; subtotal: number; total: number }
  | { ok: false; errors: string[] };

function generateOrderNumber(): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `AR-${datePart}-${rand}`;
}

// The row shape actually inserted into order_items — shared by both line
// kinds so createOrder doesn't need to know the difference at insert time.
interface PricedOrderItem {
  item_kind: "made_to_order" | "ready_for_delivery";
  product_id: string | null;
  ready_for_delivery_item_id: string | null;
  product_name_snapshot: string;
  quantity: number;
  unit_price: number;
  configuration_snapshot: Json;
}

type PriceLineResult = { ok: true; item: PricedOrderItem } | { ok: false; errors: string[] };

// Re-derives one made-to-order line entirely from the database — the ONLY
// place a price is trusted is here, never from the caller's input.
async function priceMadeToOrderLine(
  admin: ReturnType<typeof createAdminClient>,
  line: MadeToOrderInputLine
): Promise<PriceLineResult> {
  const errors: string[] = [];

  if (!Number.isInteger(line.quantity) || line.quantity < 1) {
    return { ok: false, errors: [`Invalid quantity for product ${line.productId}.`] };
  }

  const { data: row, error } = await admin
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("id", line.productId)
    .eq("active", true)
    .maybeSingle();

  if (error || !row) {
    if (error) logOrderError(error.message, { operation: "price_line_fetch_product" });
    return { ok: false, errors: [`Product ${line.productId} not found or is no longer available.`] };
  }

  const bag = mapRowToBag(row as unknown as ProductRow);

  const colour = bag.colours.find((c) => c.id === line.colourId);
  if (!colour) errors.push(`"${bag.name}": selected colour is not available.`);

  const secondaryColour = line.secondaryColourId
    ? bag.colours.find((c) => c.id === line.secondaryColourId && c.isTwoTone)
    : undefined;
  if (line.secondaryColourId && !secondaryColour) {
    errors.push(`"${bag.name}": selected two-tone colour is not available.`);
  }

  // Sizes are optional at the bag level (the real catalog currently has no
  // size options at all) — only require a match when the bag actually offers
  // sizes.
  const hasSizes = Boolean(bag.sizes && bag.sizes.length);
  const size = hasSizes ? bag.sizes!.find((s) => s.id === line.sizeId) : undefined;
  if (hasSizes && !size) errors.push(`"${bag.name}": selected size is not available.`);

  const strap = line.strapId ? bag.straps?.find((s) => s.id === line.strapId) : undefined;
  if (line.strapId && !strap) errors.push(`"${bag.name}": selected strap is not available.`);

  const handle = line.handleId ? bag.handles?.find((h) => h.id === line.handleId) : undefined;
  if (line.handleId && !handle) errors.push(`"${bag.name}": selected handle is not available.`);

  const chain = line.chainId ? bag.chains?.find((c) => c.id === line.chainId) : undefined;
  if (line.chainId && !chain) errors.push(`"${bag.name}": selected chain is not available.`);

  if (colour && strap?.compatibleWith && !strap.compatibleWith.includes(colour.id)) {
    errors.push(`"${bag.name}": "${strap.label}" is not available in "${colour.name}".`);
  }
  if (colour && handle?.compatibleWith && !handle.compatibleWith.includes(colour.id)) {
    errors.push(`"${bag.name}": "${handle.label}" is not available in "${colour.name}".`);
  }
  if (colour && chain?.compatibleWith && !chain.compatibleWith.includes(colour.id)) {
    errors.push(`"${bag.name}": "${chain.label}" is not available in "${colour.name}".`);
  }

  const requestedAddonIds = line.addonIds ?? [];
  const addons = requestedAddonIds
    .map((id) => bag.addons?.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a));
  if (addons.length !== requestedAddonIds.length) {
    errors.push(`"${bag.name}": one or more selected add-ons are not available.`);
  }
  if (colour) {
    for (const addon of addons) {
      if (addon.compatibleWith && !addon.compatibleWith.includes(colour.id)) {
        errors.push(`"${bag.name}": "${addon.label}" is not available in "${colour.name}".`);
      }
    }
  }

  if (errors.length > 0 || !colour || (hasSizes && !size)) {
    return { ok: false, errors };
  }

  const selection: Selection = {
    colourId: colour.id,
    secondaryColourId: secondaryColour?.id ?? null,
    sizeId: size?.id ?? null,
    strapId: strap?.id ?? null,
    handleId: handle?.id ?? null,
    chainId: chain?.id ?? null,
    addonIds: addons.map((a) => a.id),
  };

  // Server-computed — the client never gets to supply a price.
  const unitPrice = computeUnitPrice(bag, selection);
  const snapshot = buildCartSnapshot(bag, selection);

  return {
    ok: true,
    item: {
      item_kind: "made_to_order",
      product_id: bag.id,
      ready_for_delivery_item_id: null,
      product_name_snapshot: bag.name,
      quantity: line.quantity,
      unit_price: unitPrice,
      configuration_snapshot: snapshot as unknown as Json,
    },
  };
}

// Re-derives one Ready for Delivery line entirely from the database.
// Enforces the real stock gate server-side (never trust a client-sent
// quantity/availability): active=false or quantity_available too low both
// fail the order, same severity as a made-to-order product no longer
// existing — never silently substitute or partially fulfil.
async function priceReadyForDeliveryLine(
  admin: ReturnType<typeof createAdminClient>,
  line: ReadyForDeliveryInputLine
): Promise<PriceLineResult> {
  if (!Number.isInteger(line.quantity) || line.quantity < 1) {
    return { ok: false, errors: [`Invalid quantity for item ${line.itemId}.`] };
  }

  const { data: row, error } = await admin
    .from("ready_for_delivery_items")
    .select(
      "id, title, price, quantity_available, active, product_id, configuration_description, colour_id, secondary_colour_id, size_id, strap_id, chain_id, products ( name ), colours:colour_id ( name ), secondary_colours:secondary_colour_id ( name ), sizes ( name ), straps:strap_id ( name ), chains:chain_id ( name ), ready_for_delivery_item_images ( id, image_url, sort_order )"
    )
    .eq("id", line.itemId)
    .maybeSingle();

  if (error || !row) {
    if (error) logOrderError(error.message, { operation: "price_ready_for_delivery_line_fetch" });
    return { ok: false, errors: [`Ready for Delivery item ${line.itemId} not found.`] };
  }
  if (!row.active) {
    return { ok: false, errors: [`"${row.title}" is no longer available.`] };
  }
  // A friendly pre-check only. It is NOT the stock gate: between here and the
  // insert another buyer can take the last unit. The authoritative gate is the
  // atomic claim in claimReadyStock() below, which runs after pricing. This
  // check exists so the common case returns a precise message ("only 2 left")
  // instead of a generic sold-out from the claim.
  if (row.quantity_available < line.quantity) {
    return {
      ok: false,
      errors: [
        row.quantity_available === 0
          ? `"${row.title}" is sold out.`
          : `Only ${row.quantity_available} of "${row.title}" available.`,
      ],
    };
  }

  const storeSettings = await getStoreSettings();
  const images = [...row.ready_for_delivery_item_images]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((img) => ({ id: img.id, url: img.image_url }));

  const snapshot = buildReadyForDeliverySnapshot(
    {
      id: row.id,
      productId: row.product_id,
      productName: row.products?.name ?? "",
      productSlug: "",
      title: row.title,
      colourName: row.colours?.name ?? null,
      secondaryColourName: row.secondary_colours?.name ?? null,
      sizeLabel: row.sizes?.name ?? null,
      strapLabel: row.straps?.name ?? null,
      chainLabel: row.chains?.name ?? null,
      configurationDescription: row.configuration_description,
      price: row.price,
      quantityAvailable: row.quantity_available,
      images,
    },
    storeSettings?.readyForDeliveryFulfillmentLabel ?? "Next day"
  );

  return {
    ok: true,
    item: {
      item_kind: "ready_for_delivery",
      product_id: row.product_id,
      ready_for_delivery_item_id: row.id,
      product_name_snapshot: row.title,
      quantity: line.quantity,
      // Server-computed from the DB row — the client never gets to supply a
      // price, same rule as made-to-order.
      unit_price: row.price,
      configuration_snapshot: snapshot as unknown as Json,
    },
  };
}

interface StockClaim {
  itemId: string;
  quantity: number;
}

/**
 * Atomically claims stock for every Ready for Delivery line.
 *
 * This — not priceReadyForDeliveryLine's read — is the real stock gate.
 * public.claim_ready_for_delivery_stock does a conditional UPDATE, so two
 * concurrent callers serialise on the row lock and only one can take the last
 * unit. On partial failure every already-claimed line is released, so a
 * rejected order never strands inventory.
 */
async function claimReadyStock(
  admin: ReturnType<typeof createAdminClient>,
  claims: StockClaim[]
): Promise<{ ok: true; claimed: StockClaim[] } | { ok: false; errors: string[]; claimed: StockClaim[] }> {
  const claimed: StockClaim[] = [];
  for (const claim of claims) {
    const { data, error } = await admin.rpc("claim_ready_for_delivery_stock", {
      p_item_id: claim.itemId,
      p_quantity: claim.quantity,
    });
    if (error) {
      logOrderError(error.message, { operation: "claim_ready_for_delivery_stock" });
      return { ok: false, errors: ["Could not reserve stock. Please try again."], claimed };
    }
    if (data !== 1) {
      // Someone took it between pricing and claiming, or it was unpublished.
      return {
        ok: false,
        errors: ["Sorry — one of the ready-to-ship pieces in your cart just sold. Please review your cart and try again."],
        claimed,
      };
    }
    claimed.push(claim);
  }
  return { ok: true, claimed };
}

/** Compensating action: hand back stock claimed for an order that then failed. */
async function releaseReadyStock(
  admin: ReturnType<typeof createAdminClient>,
  claimed: StockClaim[]
): Promise<void> {
  for (const claim of claimed) {
    const { error } = await admin.rpc("release_ready_for_delivery_stock", {
      p_item_id: claim.itemId,
      p_quantity: claim.quantity,
    });
    if (error) {
      // Log loudly: this is stock that is now invisible to customers but not
      // sold. It needs manual correction.
      logOrderError(`STOCK LEAK: failed to release ${claim.quantity} of ${claim.itemId}: ${error.message}`, {
        operation: "release_ready_for_delivery_stock",
      });
    }
  }
}

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const errors: string[] = [];
  if (!input.customerName?.trim()) errors.push("Customer name is required.");
  if (!input.customerEmail?.trim()) errors.push("Customer email is required.");
  if (!input.items?.length) errors.push("Cart is empty.");
  if (!input.shippingZone) errors.push("Shipping destination is required.");
  if (errors.length > 0) return { ok: false, errors };

  // Server-side authoritative shipping lookup — never trust a client-sent
  // amount, and never invent one for a zone with no confirmed rate.
  const shippingRules = await getShippingRules();
  const shippingRule = shippingRules.find((r) => r.zoneKey === input.shippingZone);
  if (!shippingRule) {
    return { ok: false, errors: ["Shipping is temporarily unavailable. Please try again shortly."] };
  }
  if (shippingRule.isQuoteRequired || shippingRule.amount === null) {
    return {
      ok: false,
      errors: [
        "International shipping is calculated based on destination and isn't automatic yet — please contact us directly for a quote before this order can be completed.",
      ],
    };
  }

  const admin = createAdminClient();

  const priced = await Promise.all(
    input.items.map((line) => (line.kind === "ready_for_delivery" ? priceReadyForDeliveryLine(admin, line) : priceMadeToOrderLine(admin, line)))
  );
  const priceErrors = priced.flatMap((p) => (p.ok ? [] : p.errors));
  if (priceErrors.length > 0) return { ok: false, errors: priceErrors };

  const items = priced.filter((p): p is Extract<typeof p, { ok: true }> => p.ok).map((p) => p.item);

  // Claim stock BEFORE writing the order. Order creation is the commitment
  // point in this system — there is no payment step to sit between reserve and
  // confirm, so a single claim is the correct granularity. If a payment
  // provider is added, split this into reserve -> fulfil with an expiry.
  const stockClaims: StockClaim[] = items
    .filter((item) => item.item_kind === "ready_for_delivery" && item.ready_for_delivery_item_id)
    .map((item) => ({ itemId: item.ready_for_delivery_item_id as string, quantity: item.quantity }));

  const claimResult = await claimReadyStock(admin, stockClaims);
  if (!claimResult.ok) {
    await releaseReadyStock(admin, claimResult.claimed);
    return { ok: false, errors: claimResult.errors };
  }

  const subtotal = items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);

  const shippingAmount = shippingRule.amount;
  const total = subtotal + shippingAmount;
  const orderNumber = generateOrderNumber();

  // Currency comes from store_settings when available; if the settings read
  // failed, omit the column entirely and let the DB's own confirmed default
  // ('jod', set in supabase/migrations/20260902120100_set_orders_currency_default_jod.sql)
  // apply — never guess a currency in application code.
  const storeSettings = await getStoreSettings();
  const currency = storeSettings?.currencyCode.toLowerCase();

  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      order_number: orderNumber,
      customer_name: input.customerName,
      customer_email: input.customerEmail,
      customer_phone: input.customerPhone ?? null,
      subtotal,
      shipping_amount: shippingAmount,
      total,
      ...(currency ? { currency } : {}),
      shipping_address: (input.shippingAddress as Json | undefined) ?? null,
      notes: input.notes ?? null,
    })
    .select()
    .single();

  if (orderError || !order) {
    logOrderError(orderError?.message ?? "Failed to create order.", { operation: "insert_order" });
    await releaseReadyStock(admin, claimResult.claimed);
    return { ok: false, errors: [orderError?.message ?? "Failed to create order."] };
  }

  const { error: itemsError } = await admin.from("order_items").insert(
    items.map((item) => ({
      ...item,
      order_id: order.id,
    }))
  );

  if (itemsError) {
    logOrderError(itemsError.message, { operation: "insert_order_items", orderId: order.id });
    // Best-effort cleanup — no multi-statement transaction available via the
    // JS client for a plain insert pair; if this matters more once Stripe is
    // wired, move both inserts into a single Postgres function instead.
    await admin.from("orders").delete().eq("id", order.id);
    await releaseReadyStock(admin, claimResult.claimed);
    return { ok: false, errors: [itemsError.message] };
  }

  return { ok: true, orderId: order.id, orderNumber, subtotal, total };
}
