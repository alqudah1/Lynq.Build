# Replacing the Dev Seed With Rand's Real Catalog — Safely

**Do not run any of this yet.** This is the documented procedure for when
`clients/Arcubed_Label/01_Client_Info/product-matrix.md` is filled in. It
exists now so the replacement is a known, safe, repeatable process rather
than something improvised under time pressure later.

## The core rule: upsert by natural key, never blind INSERT

Every table below has a natural key that already has (or can have) a real
uniqueness constraint:

| Table | Natural key | Constraint status |
|---|---|---|
| `products` | `slug` | already `unique` (see migration) |
| `colours` | `name` | not yet unique — add one before importing real data (see below) |
| `sizes` | `name` | same |
| `straps_handles` | `name` | same |
| `addons` | `name` | same |
| `product_colours` / `product_sizes` / `product_straps_handles` / `product_addons` | `(product_id, <option>_id)` | already `unique` (see migration) |

Because `products.slug` and the four join tables are already unique-
constrained, importing real data with `INSERT ... ON CONFLICT (...) DO
UPDATE SET ...` (the same pattern `supabase/seed.sql` already uses) is safe
to run more than once — re-running an import updates existing rows in place
instead of creating duplicates.

`colours`/`sizes`/`straps_handles`/`addons` do NOT have a uniqueness
constraint on `name` yet (nothing required one when the only data was the
mock seed). **Before importing real data**, add one migration:

```sql
alter table public.colours add constraint colours_name_key unique (name);
alter table public.sizes add constraint sizes_name_key unique (name);
alter table public.straps_handles add constraint straps_handles_name_key unique (name);
alter table public.addons add constraint addons_name_key unique (name);
```

Create this via `supabase migration new add_unique_name_constraints`, review
it, then apply it — same process as the initial schema migration. Do this
once, before the first real import, not per-import.

## Import order (respects foreign keys)

1. `colours.csv`, `sizes.csv`, `straps_handles.csv`, `addons.csv` — upsert by `name`.
2. `products.csv` — upsert by `slug`.
3. `product_colours.csv`, `product_sizes.csv`, `product_straps_handles.csv`, `product_addons.csv` — look up the option's id by name and the product's id by slug, then upsert by `(product_id, <option>_id)`.
4. `product_images.csv` — look up the product's id by slug, then insert (no natural key to upsert on beyond `(product_id, image_url)`; consider adding one if re-imports of images become routine).

## What "safely" means in practice

- **Never `DELETE FROM products` before importing.** If a product's `active`
  should become `false` (discontinued), update that one row — do not clear
  and re-insert the table. `order_items.product_id` is `ON DELETE SET NULL`
  specifically so a real order never breaks if a product is later removed,
  but there is no reason to force that path during a routine catalog update.
- **Dry-run first.** Run the upsert statements inside a transaction
  (`BEGIN; ... ; ROLLBACK;`) once to see the row counts Postgres reports,
  before committing for real.
- **The dev seed can stay.** Nothing in this procedure requires deleting
  `supabase/seed.sql`'s rows first — if Rand's real products get different
  slugs/names than the mock catalog (which they will), both can coexist
  harmlessly until someone explicitly deactivates or removes the mock rows.
  Do not delete the mock seed as part of a real-data import; that's a
  separate, explicit decision for later.
- **Re-run the type generation after any schema change** (like the unique
  constraints above): `supabase gen types typescript --project-id
  fnswiyxjbsabomktqizr > src/lib/supabase/types.ts`.

## Actually loading the CSVs

Once the CSVs in this folder are filled in (not just headers), the
straightforward path is `psql`'s `\copy` into a set of staging tables, then
the upserts above from staging into the real tables — this avoids writing a
one-off script and keeps every step visible/reviewable in plain SQL. The
exact staging-table SQL will get written when there's real data to test it
against, not before.
