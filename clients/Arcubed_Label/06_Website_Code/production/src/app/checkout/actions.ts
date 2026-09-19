"use server";

// The customer-facing entry point to order creation — the thin Server Action
// wrapper that src/lib/orders.ts always anticipated. orders.ts stays
// `server-only` and is never itself an action, so the RPC surface is exactly
// this one function with explicit validation in front of it.
//
// PRICE AUTHORITY: the client sends IDs and quantities ONLY. Any price,
// subtotal, shipping or total present in the submitted payload is ignored —
// every amount is recomputed server-side from the database. This is the class
// of bug that previously shipped Nova at JOD 65 instead of 55.

import { createOrder, type CreateOrderResult } from "@/lib/orders";
import { getShippingRules } from "@/lib/repository";

export interface CheckoutLineInput {
  kind: "made_to_order" | "ready_for_delivery";
  qty: number;
  // made_to_order
  bagId?: string;
  colourId?: string;
  secondaryColourId?: string | null;
  sizeId?: string | null;
  strapId?: string | null;
  handleId?: string | null;
  chainId?: string | null;
  addonIds?: string[];
  // ready_for_delivery
  itemId?: string;
}

export interface CheckoutInput {
  fullName: string;
  phone: string;
  email: string;
  zoneKey: string;
  city: string;
  address: string;
  building?: string;
  country?: string;
  notes?: string;
  items: CheckoutLineInput[];
  idempotencyKey: string;
}

export type CheckoutResult =
  | {
      ok: true;
      orderNumber: string;
      confirmationToken: string;
      duplicate: boolean;
    }
  | { ok: false; errors: string[]; soldOut?: boolean };

const MAX_QTY = 20;

/** Phone check is deliberately permissive: Jordanian and international formats
 *  vary widely and a strict pattern rejects legitimate customers. We require
 *  enough digits to be a real number and nothing more. */
function phoneLooksReal(v: string): boolean {
  const digits = v.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

function emailLooksReal(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export async function submitOrder(input: CheckoutInput): Promise<CheckoutResult> {
  const errors: string[] = [];

  const fullName = (input.fullName ?? "").trim();
  const phone = (input.phone ?? "").trim();
  const email = (input.email ?? "").trim();
  const city = (input.city ?? "").trim();
  const address = (input.address ?? "").trim();
  const building = (input.building ?? "").trim();
  const country = (input.country ?? "").trim();
  const notes = (input.notes ?? "").trim();

  if (!fullName) errors.push("Please enter your full name.");
  if (!phone) errors.push("Please enter a phone number so we can reach you about delivery.");
  else if (!phoneLooksReal(phone)) errors.push("That phone number doesn't look complete. Please check it.");
  if (!email) errors.push("Please enter an email address for your order confirmation.");
  else if (!emailLooksReal(email)) errors.push("That email address doesn't look right. Please check it.");
  if (!input.zoneKey) errors.push("Please choose where we're delivering to.");
  if (!address) errors.push("Please enter a delivery address.");
  if (!Array.isArray(input.items) || input.items.length === 0) errors.push("Your cart is empty.");
  if (!input.idempotencyKey) errors.push("Something went wrong preparing your order. Please refresh and try again.");

  // The zone must be one the store actually has a rule for — never trust a
  // client-supplied zone key.
  const rules = await getShippingRules();
  const rule = rules.find((r) => r.zoneKey === input.zoneKey);
  if (input.zoneKey && !rule) errors.push("Please choose a valid delivery area.");
  if (rule?.zoneKey === "international" && !country) {
    errors.push("Please tell us which country we're shipping to so we can quote the cost.");
  }
  if (rule && rule.zoneKey !== "international" && !city) {
    errors.push("Please enter your city or delivery area.");
  }

  for (const line of input.items ?? []) {
    if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > MAX_QTY) {
      errors.push("One of the items has an invalid quantity.");
      break;
    }
    if (line.kind === "made_to_order" && (!line.bagId || !line.colourId)) {
      errors.push("One of your items is incomplete. Please remove and re-add it.");
      break;
    }
    if (line.kind === "ready_for_delivery" && !line.itemId) {
      errors.push("One of your ready-to-ship items is incomplete. Please remove and re-add it.");
      break;
    }
  }

  if (errors.length) return { ok: false, errors };

  // IDs only. Nothing price-shaped crosses this boundary.
  const result: CreateOrderResult = await createOrder({
    customerName: fullName,
    customerEmail: email,
    customerPhone: phone,
    shippingZone: rule!.zoneKey,
    shippingAddress: {
      country: country || "Jordan",
      city,
      address,
      ...(building ? { building } : {}),
      zone: rule!.label,
    },
    notes: notes || undefined,
    idempotencyKey: input.idempotencyKey,
    items: input.items.map((l) =>
      l.kind === "ready_for_delivery"
        ? { kind: "ready_for_delivery" as const, itemId: l.itemId!, quantity: l.qty }
        : {
            kind: "made_to_order" as const,
            productId: l.bagId!,
            colourId: l.colourId!,
            secondaryColourId: l.secondaryColourId ?? null,
            sizeId: l.sizeId ?? null,
            strapId: l.strapId ?? null,
            handleId: l.handleId ?? null,
            chainId: l.chainId ?? null,
            addonIds: l.addonIds ?? [],
            quantity: l.qty,
          }
    ),
  });

  if (!result.ok) return { ok: false, errors: result.errors, soldOut: result.soldOut };

  return {
    ok: true,
    orderNumber: result.orderNumber,
    confirmationToken: result.confirmationToken,
    duplicate: result.duplicate,
  };
}
