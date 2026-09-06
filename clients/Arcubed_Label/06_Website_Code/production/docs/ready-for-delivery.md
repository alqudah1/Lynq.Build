# Ready for Delivery

Rand's own words, from the confirmed real-data brief: "Can we add ready for
delivery orders, to upload any bags in stock, these would be delivered next
day." This document is the full architecture for that feature — data model,
storefront flow, how Rand actually lists an item (no admin UI was built —
see "Minimum management architecture" below), and inventory behavior.

Ready for Delivery is a **separate purchase path from the made-to-order
customizer**, for a specific reason: a ready item is one exact physical bag
that already exists — real photos, one fixed configuration, no colour/size/
strap picker needed — where a made-to-order item is a live configuration of
the product catalog, resolved through the 3D customizer and priced by rule.
The two share underlying vocabulary (product, colour, size, strap/chain)
but not a table, a UI flow, or a fulfillment promise.

## Data model

Two new tables (`20260903090200_add_ready_for_delivery_architecture.sql`):

- **`public.ready_for_delivery_items`** — one row per physical bag Rand has
  in stock and wants to sell as-is. `product_id` + optional `colour_id` /
  `secondary_colour_id` / `size_id` / `strap_id` / `chain_id` reference the
  same catalog the customizer uses (so "this is a Regular Nova in Gold with
  a Crochet Strap" stays consistent with real product/colour/size/strap
  data, not a hand-typed duplicate of it), plus an optional
  `configuration_description` free-text override for anything the
  structured fields can't capture cleanly. `price`, `quantity_available`,
  `active` (publish/unpublish), `sort_order`.
- **`public.ready_for_delivery_item_images`** — real photos of one specific
  item, `ready_for_delivery_item_id` FK, `on delete cascade`. No rows exist
  yet; no ready inventory has been uploaded.

`public.order_items` was extended, not duplicated, so a single order can
mix made-to-order and ready-for-delivery lines: `item_kind` (`'made_to_order'
| 'ready_for_delivery'`, discriminator) and `ready_for_delivery_item_id`
(nullable FK, `on delete set null`), with a check constraint
(`order_items_kind_reference_check`) enforcing that a `made_to_order` row
has no ready reference and a `ready_for_delivery` row always has one.

`public.store_settings.ready_for_delivery_fulfillment_label` holds the
confirmed fulfillment promise ("Next day," Rand's own words) as a single DB
source of truth rather than a hardcoded string in components — same pattern
already used for `production_time_label`.

RLS: both new tables are public-SELECT (`active = true` on items; images
follow their parent item's `active` flag), full access for `service_role`
only — same pattern as every other catalog table, see the migration for
the exact policies and grants.

### App-side types and functions

- `ReadyForDeliveryItem` / `ReadyForDeliveryImage` (`src/lib/types.ts`) —
  the shape the storefront reads.
- `getReadyForDeliveryItems()` / `getReadyForDeliveryItemById(id)`
  (`src/lib/repository.ts`) — same `isSupabaseConfigured` / dev-mock-fallback
  / `CatalogUnavailableError`-in-production pattern as `getActiveBags()`.
  Ready for Delivery is treated as core shop functionality, not a decorative
  extra, so a real fetch failure in production surfaces the same way a
  made-to-order catalog failure would.
- `buildReadyForDeliverySnapshot()` (`src/lib/pricing.ts`) — captures a
  `ReadyForDeliverySnapshot` (title, colours, size, strap/chain, description,
  first photo, fulfillment label) once, at add-to-cart/order time,
  independent of the live catalog row — mirrors `CartItemSnapshot`'s
  reasoning for made-to-order lines. If Rand edits or unpublishes the row
  later, past carts/orders still show exactly what was actually bought.
- `ReadyForDeliveryCartItem` / `CartLine = CartItem | ReadyForDeliveryCartItem`
  (`src/lib/types.ts`) — the cart and localStorage persistence
  (`cart-context.tsx`) carry both kinds of line side by side.
- `ReadyForDeliveryInputLine` / `priceReadyForDeliveryLine()`
  (`src/lib/orders.ts`) — server-side order pricing for a ready line: 404s
  if the row is missing, rejects if `!active` ("no longer available") or
  `quantity_available < requested` (sold-out vs. partial-stock get distinct
  error messages), and always prices from the DB row (`row.price`), never
  from anything the client sends.

## Storefront flow

```
Home / Shop nav → "Ready for Delivery" → grid of in-stock items
  → item detail (real photos, exact configuration, price, qty stepper)
  → Add to Cart → /cart (mixed with any made-to-order lines)
  → checkout (same order pipeline, item_kind discriminates each line)
```

- `/ready-for-delivery` (`src/app/ready-for-delivery/page.tsx`) — server
  component, fetches items + store settings, empty-state copy if nothing is
  published yet, otherwise a grid of `ReadyForDeliveryCard` (thumbnail,
  "Sold out" badge when `quantityAvailable <= 0`, title, price).
- `/ready-for-delivery/[id]` (`.../[id]/page.tsx` +
  `ReadyForDeliveryDetail.tsx`) — `notFound()` if the id doesn't resolve;
  otherwise real photo + thumbnail row, the composed configuration
  description, price, and the same `AddToCartInline` /
  `AddToCartStickyBar` controls the customizer uses, disabled and labeled
  "Sold Out" once depleted. No customizer, no 3D viewer, no colour/size
  picker — the whole point is that the physical bag is already fixed.
- Nav: "Ready for Delivery" link added to `Header`, `MobileMenu`, and
  `Footer`, between Shop and About.
- `/cart` and the cart drawer render made-to-order and ready-for-delivery
  lines with distinct layouts (`CartLineItem.tsx`, `CartDrawer.tsx`) —
  ready lines show the real photo, "Ready for Delivery · {fulfillment
  label}," and a qty stepper with no "Edit" link (there's no configuration
  to re-open).
- `/faq` states both fulfillment promises (made-to-order 3–5 business days,
  Ready for Delivery next day) and both return-policy summaries — see
  `product-matrix.md`'s "Return / exchange policy" section and the
  `return_policies` table.

## Minimum management architecture

Per the explicit instruction: **do not build a large ERP/admin system.**
There is no admin UI for Ready for Delivery. Rand lists an item by direct
database access — Supabase Studio's table editor, or a `service_role`
script — against the tables above:

1. Insert a `ready_for_delivery_items` row: `product_id` (which product
   this bag is), the colour/secondary_colour/size/strap/chain FKs that
   match the real bag (or leave any null and rely on
   `configuration_description` instead), `price`, `quantity_available`,
   `active = true` to publish.
2. Insert one or more `ready_for_delivery_item_images` rows with real photo
   URLs, in display order via `sort_order`.
3. To unpublish without losing history: `active = false`. To mark sold out
   without unpublishing: `quantity_available = 0` (the item still shows,
   badged "Sold out," rather than vanishing — see below). To restock: raise
   `quantity_available` again.

This is intentionally minimal — it needs Supabase Studio access, not a new
codebase feature. If Rand later wants a real upload/publish UI, that is a
distinct, larger feature to scope separately, not something implied by
"minimum management architecture" today.

## Inventory behavior

- `quantity_available = 0` stops the item from being purchasable
  (`priceReadyForDeliveryLine` rejects the order server-side; the detail
  page disables Add to Cart and shows "Sold Out") but the row is **not**
  deleted and stays visible — a sold-out item reads as unavailable, not as
  a dead link, and Rand can still see what's out of stock.
- Deleting inventory is never required to stop sales — `active = false` or
  `quantity_available = 0` both do that non-destructively.
- Historical orders survive both cases: `order_items.ready_for_delivery_item_id`
  is `on delete set null`, and the order's `configuration_snapshot` (built
  once, at purchase time, via `buildReadyForDeliverySnapshot`) is the
  permanent record of what was actually bought — it does not depend on the
  `ready_for_delivery_items` row continuing to exist or stay unchanged.
- There is no atomic stock-decrement transaction yet (i.e., two simultaneous
  checkouts for the last unit could both pass the pre-check) — out of scope
  for this phase since Stripe/checkout isn't wired up yet; flagged here so
  it isn't forgotten once real payments are connected.

## What's needed to list the first real item

1. One real photo (or more) of an actual in-stock bag.
2. Its real price and available quantity from Rand.
3. Which product/colour/size/strap/chain it matches (or a plain-text
   description if it doesn't map cleanly to existing catalog rows).
4. Someone with Supabase Studio access to insert the two rows described
   above.

No code changes are required to list the first item — the schema, storefront
routes, cart/order handling, and snapshot preservation are already built and
wired end to end.
