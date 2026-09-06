# Arcubed Label — Client Data Import Templates

These CSVs are the structured, database-shaped counterpart to
`clients/Arcubed_Label/01_Client_Info/product-matrix.md` (the human-readable
document to fill in from Rand's WhatsApp answers). Once that document is
complete, its answers get transcribed into these CSVs, which map directly
onto the tables in `supabase/migrations/20260829021026_init_arcubed_schema.sql`.

**Every file here has headers only — no rows.** Do not fill these with
invented data. They exist so that when real answers arrive, there is an
unambiguous place for each piece of information to go, matching the actual
database schema field-for-field.

## Import order (respects foreign keys)

1. `products.csv`
2. `colours.csv`, `sizes.csv`, `straps_handles.csv`, `addons.csv` (independent catalogs)
3. `product_colours.csv`, `product_sizes.csv`, `product_straps_handles.csv`, `product_addons.csv` (link products to the catalogs above, with per-product price_delta/availability)
4. `product_images.csv`

## Fields that exist in the templates but NOT in the current database schema

These three are real gaps, not oversights — the schema doesn't have columns
for them yet because they weren't part of the original spec, and no
placeholder value has been invented in code for two of them beyond an
explicit, clearly-flagged stand-in:

- **`currency`** — `orders.currency` currently defaults to `'usd'` in the
  schema (`supabase/migrations/20260829021026_init_arcubed_schema.sql` line
  ~165). There is no per-product currency column. If Rand's real currency is
  something other than USD, this needs a migration change, not just a data
  import.
- **`production_time`** — not a database column anywhere. Currently a
  hardcoded string ("Handmade to order — usually ships in 2–3 weeks")
  repeated in three places in the frontend (see the mock-dependency audit in
  the phase report). Captured here per-product in case it varies by bag; if
  Rand confirms one universal lead time, this can instead become a single
  site-wide constant.
- **`shipping_rules`** — no schema table exists for shipping rules at all.
  `src/lib/orders.ts` currently hardcodes `shippingAmount = 0` with a comment
  flagging it as an explicit placeholder, not a real rate. Real shipping
  rules (flat rate, by region, free-over-threshold, etc.) will likely need
  their own small table once Rand confirms the policy — captured here as
  free-text notes in the meantime.

## Naming, not slugs, for the shared catalogs

`colours`, `sizes`, `straps_handles`, and `addons` have no `slug` column in
the schema — only `products` does. So `colours.csv`/`sizes.csv`/etc. are
keyed by `name`, and the join-table CSVs reference them by that same `name`
(e.g. `product_colours.csv`'s `colour_name` must exactly match a row in
`colours.csv`). Products themselves are still referenced by `product_slug`,
matching `products.slug`.

## Compatibility constraints

`product_straps_handles.csv` and `product_addons.csv` each have a
`compatible_colour_names` column (semicolon-separated, matching names in
`colours.csv`). Leave blank to mean "available in every colour this product
offers" — that's the default assumed everywhere else in the app. Only fill
this in if Rand specifically confirms an option is restricted to certain
colours.
