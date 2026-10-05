# Payment integration status

## Live since launch (2026-10-05): Cash on Delivery

Rand confirmed: *"I would keep it cliq or cash on delivery."*

- **Cash on Delivery is the live method.** Checkout states it under "Payment
  method": payment is due when the order is delivered, nothing is charged
  online, and there are no card fields. Every order records
  `orders.payment_method = 'cash_on_delivery'`
  (`supabase/migrations/20261005120000_orders_payment_method.sql`) and stays
  `payment_status = 'unpaid'` until Rand marks it paid in `/admin/orders`.
  The confirmation page and the admin both show the method.
- **CliQ is prepared, not offered.** The schema and `src/lib/payment.ts` know
  the value `cliq`, but it is not in `AVAILABLE_PAYMENT_METHODS`, so checkout
  never shows it and the server refuses it. To turn it on, Rand supplies her
  real CliQ alias and the details customers should send to; then add `cliq` to
  that list and show those details at checkout and on the confirmation. Do not
  invent an alias, number or bank detail.
- Orders placed before 2026-10-05 have `payment_method = null` (they never
  declared one) and show no method in the admin.

Everything below describes the state before launch and is kept as history.

## Where this actually stood before launch

**No payment provider is integrated, and no card details are collected
anywhere.** Checkout creates a real order with `payment_status = 'unpaid'` and
tells the customer, in these words: *"No payment is taken here. Arcubed
confirms your order and arranges payment and delivery with you directly."*

That statement is currently true, which is the important part. There are no
fake card fields on the site.

## What already exists to build on

- Orders are created server-side with **server-authoritative pricing**: the
  client sends IDs and quantities only, and every amount is recomputed on the
  server (`src/lib/orders.ts`).
- Order creation is **idempotent**, guarded by a unique partial index, so a
  double submit cannot create two orders.
- Ready for Delivery stock is claimed **atomically** with a conditional UPDATE
  and released on failure, so a payment step can be inserted between reserve
  and confirm without opening an overselling hole.
- The `orders` table already carries `payment_status`, and order management
  can already move an order to paid or refunded.

That is the whole integration boundary. What is missing is a provider.

## What the client has to decide

This cannot be resolved from the repository, because it depends on Rand's
business and banking situation, not on code:

1. **Which provider.** For a Jordanian business taking JOD, the realistic
   options are a local acquirer or gateway (for example HyperPay, MEPS or a
   bank-provided gateway) or PayPal. Stripe does not currently support
   businesses registered in Jordan, so the usual default does not apply here.
2. **A merchant account** with that provider, which requires business
   registration documents and a bank account.
3. **API credentials** for test and live.

## What LYNQ does once those exist

Add a payment step between order creation and confirmation, write the
provider's reference and result onto the existing `payment_status`, and
verify the webhook signature server-side. The order model does not need to
change.

## Honest summary for the client conversation

Payment is included in the Business package and is **not finished**. It is
blocked on a provider decision and merchant credentials, not on development
time. Everything the payment step will attach to is built and tested.
