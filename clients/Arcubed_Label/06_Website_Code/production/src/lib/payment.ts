// How a customer pays. Shared by checkout (client), the order Server Action,
// order creation, the confirmation page and the admin — one list, so the
// method a customer is shown is the method the server accepts and records.
//
// Cash on Delivery is the live method (Rand, 2026-10: "I would keep it cliq
// or cash on delivery"). CliQ is approved in principle, but there is no alias,
// phone or account to send a payment to yet. It is known to the schema
// (orders.payment_method, 20261005120000_orders_payment_method.sql) and to
// this file so turning it on later is a one-line change here plus the real
// destination details — until then it is NOT in AVAILABLE_PAYMENT_METHODS, so
// checkout never shows it and the server refuses it. Never invent a CliQ
// alias, number or bank detail to fill that gap.
//
// Whether money has arrived is a separate question, answered by
// orders.payment_status: every order is 'unpaid' when placed, and only Rand
// marks it 'paid' from /admin/orders.

export const PAYMENT_METHODS = ["cash_on_delivery", "cliq"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** What a customer can actually choose today. */
export const AVAILABLE_PAYMENT_METHODS: readonly PaymentMethod[] = ["cash_on_delivery"];

const LABELS: Record<PaymentMethod, string> = {
  cash_on_delivery: "Cash on Delivery",
  cliq: "CliQ",
};

export function isAvailablePaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && (AVAILABLE_PAYMENT_METHODS as readonly string[]).includes(value);
}

/** Null for orders placed before the method was recorded. */
export function paymentMethodLabel(value: string | null | undefined): string | null {
  return value && value in LABELS ? LABELS[value as PaymentMethod] : null;
}
