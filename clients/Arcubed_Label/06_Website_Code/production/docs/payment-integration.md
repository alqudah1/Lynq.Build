# Payment integration status

## Where this actually stands

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
