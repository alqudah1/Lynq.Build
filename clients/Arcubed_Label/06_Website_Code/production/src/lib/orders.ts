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
  /**
   * Per-attempt token from the client. Two submissions carrying the same key
   * produce ONE order: the unique index on orders.idempotency_key is the real
   * guarantee, so a double-click or a browser retry after a slow response
   * cannot bill a customer twice.
   */
  idempotencyKey?: string;
}

export type CreateOrderResult =
  | {
      ok: true;
      orderId: string;
      orderNumber: string;
      /** Unguessable key for the confirmation page — order_number is not. */
      confirmationToken: string;
      subtotal: number;
      total: number;
      shippingAmount: number;
      shippingQuoteRequired: boolean;
      /** True when an existing order was returned instead of a new one. */
      duplicate: boolean;
    }
  | { ok: false; errors: string[]; soldOut?: boolean };

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
        errors: ["Sorry, one of the ready-to-ship pieces in your cart just sold. Please review your cart and try again."],
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
  // International: the rate genuinely depends on destination country and no
  // rate is confirmed, so none is invented. The order is still recorded, with
  // shipping_quote_required = true, shipping_amount 0, and a total that is the
  // goods subtotal only — never presented to the customer as a final amount.
  const quoteRequired = shippingRule.isQuoteRequired || shippingRule.amount === null;

  const admin = createAdminClient();

  // Idempotency: if this attempt already produced an order, return that one.
  if (input.idempotencyKey) {
    const { data: existing } = await admin
      .from("orders")
      .select("id, order_number, confirmation_token, subtotal, total, shipping_amount, shipping_quote_required")
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    if (existing) {
      return {
        ok: true,
        orderId: existing.id,
        orderNumber: existing.order_number,
        confirmationToken: existing.confirmation_token,
        subtotal: Number(existing.subtotal),
        total: Number(existing.total),
        shippingAmount: Number(existing.shipping_amount),
        shippingQuoteRequired: existing.shipping_quote_required,
        duplicate: true,
      };
    }
  }

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
    return { ok: false, errors: claimResult.errors, soldOut: true };
  }

  const subtotal = items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);

  const shippingAmount = quoteRequired ? 0 : (shippingRule.amount as number);
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
      shipping_quote_required: quoteRequired,
      ...(input.idempotencyKey ? { idempotency_key: input.idempotencyKey } : {}),
    })
    .select()
    .single();

  if (orderError || !order) {
    // Unique violation on idempotency_key means a concurrent request with the
    // same token won the race. That is success, not failure: return ITS order
    // and hand back the stock this attempt claimed, or the item is double-counted.
    if (orderError?.code === "23505" && input.idempotencyKey) {
      await releaseReadyStock(admin, claimResult.claimed);
      const { data: winner } = await admin
        .from("orders")
        .select("id, order_number, confirmation_token, subtotal, total, shipping_amount, shipping_quote_required")
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (winner) {
        return {
          ok: true,
          orderId: winner.id,
          orderNumber: winner.order_number,
          confirmationToken: winner.confirmation_token,
          subtotal: Number(winner.subtotal),
          total: Number(winner.total),
          shippingAmount: Number(winner.shipping_amount),
          shippingQuoteRequired: winner.shipping_quote_required,
          duplicate: true,
        };
      }
    }
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

  return {
    ok: true,
    orderId: order.id,
    orderNumber,
    confirmationToken: order.confirmation_token,
    subtotal,
    total,
    shippingAmount,
    shippingQuoteRequired: quoteRequired,
    duplicate: false,
  };
}

export interface OrderConfirmationLine {
  kind: "made_to_order" | "ready_for_delivery";
  name: string;
  configuration: string[];
  quantity: number;
  unitPrice: number;
  bagSlug: string | null;
  colourName: string | null;
}

export interface OrderConfirmation {
  orderNumber: string;
  createdAt: string;
  status: string;
  paymentStatus: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  shippingAddress: Record<string, unknown> | null;
  subtotal: number;
  shippingAmount: number;
  total: number;
  currency: string;
  shippingQuoteRequired: boolean;
  lines: OrderConfirmationLine[];
}

/**
 * Loads one order for its confirmation page.
 *
 * Addressed by confirmation_token (a UUID), never by order_number — the
 * number is AR-YYYYMMDD-XXXX, only four random characters, and would be
 * enumerable. orders/order_items carry no anon or authenticated grant at all,
 * so this service-role read is the only path to the data and it can return
 * exactly one order.
 */
export async function getOrderByConfirmationToken(token: string): Promise<OrderConfirmation | null> {
  // Reject anything that isn't a UUID before it reaches the database.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("orders")
    .select(
      "order_number, created_at, status, payment_status, customer_name, customer_email, customer_phone, shipping_address, subtotal, shipping_amount, total, currency, shipping_quote_required, order_items ( item_kind, product_name_snapshot, quantity, unit_price, configuration_snapshot )"
    )
    .eq("confirmation_token", token)
    .maybeSingle();

  if (error || !data) return null;

  const lines: OrderConfirmationLine[] = (data.order_items ?? []).map((it) => {
    const snap = (it.configuration_snapshot ?? {}) as Record<string, unknown>;
    const str = (k: string) => (typeof snap[k] === "string" ? (snap[k] as string) : null);
    const configuration = configurationFromSnapshot(
      it.configuration_snapshot,
      it.item_kind === "ready_for_delivery" ? "ready_for_delivery" : "made_to_order"
    );
    return {
      kind: it.item_kind === "ready_for_delivery" ? "ready_for_delivery" : "made_to_order",
      name: it.product_name_snapshot,
      configuration: configuration.filter((v): v is string => Boolean(v)),
      quantity: it.quantity,
      unitPrice: Number(it.unit_price),
      bagSlug: str("bagSlug"),
      colourName: str("colourName"),
    };
  });

  return {
    orderNumber: data.order_number,
    createdAt: data.created_at,
    status: data.status,
    paymentStatus: data.payment_status,
    customerName: data.customer_name,
    customerEmail: data.customer_email,
    customerPhone: data.customer_phone,
    shippingAddress: (data.shipping_address as Record<string, unknown> | null) ?? null,
    subtotal: Number(data.subtotal),
    shippingAmount: Number(data.shipping_amount),
    total: Number(data.total),
    currency: (data.currency ?? "jod").toUpperCase(),
    shippingQuoteRequired: data.shipping_quote_required,
    lines,
  };
}



/**
 * Human-readable configuration from a stored line snapshot.
 *
 * Shared by the customer's confirmation page and the order-management screen
 * so the two can never describe the same order differently. The admin screen
 * originally read a `configuration` array that the snapshot does not contain,
 * and silently showed nothing.
 */
export function configurationFromSnapshot(
  snapshot: unknown,
  kind: "made_to_order" | "ready_for_delivery"
): string[] {
  const snap = (snapshot ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof snap[k] === "string" ? (snap[k] as string) : null);
  const parts =
    kind === "ready_for_delivery"
      ? [str("colourName"), str("secondaryColourName"), str("sizeLabel"), str("strapLabel"), str("chainLabel")]
      : [
          str("colourName"),
          str("secondaryColourName") ? `${str("secondaryColourName")} two-tone` : null,
          str("sizeLabel") && str("sizeLabel") !== "Regular" ? str("sizeLabel") : null,
          str("strapLabel"),
          str("chainLabel"),
        ];
  return parts.filter((v): v is string => Boolean(v));
}

/* ------------------------------------------------------------------ */
/* Order management (Rand-facing). Server-only, service-role, and only  */
/* ever called from an /admin page that has already passed isAdmin().   */
/* ------------------------------------------------------------------ */

export interface AdminOrderLine {
  kind: "made_to_order" | "ready_for_delivery";
  name: string;
  configuration: string[];
  quantity: number;
  unitPrice: number;
}

export interface AdminOrder {
  id: string;
  orderNumber: string;
  createdAt: string;
  status: string;
  paymentStatus: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  shippingAddress: Record<string, unknown> | null;
  subtotal: number;
  shippingAmount: number;
  total: number;
  currency: string;
  shippingQuoteRequired: boolean;
  lines: AdminOrderLine[];
}

/** Newest first. `limit` is clamped so a bad value cannot ask for everything. */
export async function listOrders(limit = 100): Promise<AdminOrder[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, order_number, created_at, status, payment_status, customer_name, customer_email, customer_phone, shipping_address, subtotal, shipping_amount, total, currency, shipping_quote_required, order_items ( item_kind, product_name_snapshot, quantity, unit_price, configuration_snapshot )"
    )
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 200)));

  if (error || !data) return [];

  return data.map((row) => {
    const r = row as Record<string, unknown>;
    const items = (r.order_items as Record<string, unknown>[] | null) ?? [];
    return {
      id: String(r.id),
      orderNumber: String(r.order_number),
      createdAt: String(r.created_at),
      status: String(r.status),
      paymentStatus: String(r.payment_status),
      customerName: String(r.customer_name ?? ""),
      customerEmail: String(r.customer_email ?? ""),
      customerPhone: (r.customer_phone as string | null) ?? null,
      shippingAddress: (r.shipping_address as Record<string, unknown> | null) ?? null,
      subtotal: Number(r.subtotal ?? 0),
      shippingAmount: Number(r.shipping_amount ?? 0),
      total: Number(r.total ?? 0),
      currency: String(r.currency ?? "JOD"),
      shippingQuoteRequired: Boolean(r.shipping_quote_required),
      lines: items.map((it) => {
        const kind = (it.item_kind === "ready_for_delivery" ? "ready_for_delivery" : "made_to_order") as AdminOrderLine["kind"];
        return {
          kind,
          name: String(it.product_name_snapshot ?? ""),
          configuration: configurationFromSnapshot(it.configuration_snapshot, kind),
          quantity: Number(it.quantity ?? 1),
          unitPrice: Number(it.unit_price ?? 0),
        };
      }),
    };
  });
}

/** The only values an order may be moved between from the admin screen. */
export const ORDER_STATUSES = ["pending", "confirmed", "in_production", "ready", "shipped", "completed", "cancelled"] as const;
export const PAYMENT_STATUSES = ["unpaid", "paid", "refunded"] as const;

export async function updateOrderStatus(
  orderId: string,
  status: string | null,
  paymentStatus: string | null
): Promise<{ ok: boolean; error?: string }> {
  // Whitelisted, so a crafted form post cannot write an arbitrary status.
  // Typed against the generated row shape rather than Record<string,string>,
  // so the column names are checked at build time too.
  const patch: { status?: string; payment_status?: string } = {};
  if (status) {
    if (!(ORDER_STATUSES as readonly string[]).includes(status)) return { ok: false, error: "Unknown status." };
    patch.status = status;
  }
  if (paymentStatus) {
    if (!(PAYMENT_STATUSES as readonly string[]).includes(paymentStatus)) return { ok: false, error: "Unknown payment status." };
    patch.payment_status = paymentStatus;
  }
  if (!Object.keys(patch).length) return { ok: false, error: "Nothing to update." };
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return { ok: false, error: "Bad order id." };

  const supabase = createAdminClient();
  const { error } = await supabase.from("orders").update(patch).eq("id", orderId);
  if (error) return { ok: false, error: "Could not update that order." };
  return { ok: true };
}
