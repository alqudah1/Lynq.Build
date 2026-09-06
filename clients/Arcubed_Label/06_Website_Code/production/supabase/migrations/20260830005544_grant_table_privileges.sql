-- Arcubed Label — grant the table privileges the RLS policies already assume.
--
-- 20260829021026_init_arcubed_schema.sql enabled RLS and created SELECT
-- policies for anon/authenticated, but never granted table-level privileges.
-- Postgres requires BOTH: a GRANT decides whether a role may touch a table at
-- all, and only then do RLS policies decide which rows it sees. This project's
-- default privileges hand anon/authenticated/service_role no DML at all (only
-- REFERENCES/TRIGGER/TRUNCATE), so before this migration every storefront read
-- failed with 42501 "permission denied for table products" — and because
-- src/lib/repository.ts catches query errors and falls back to MOCK_BAGS, the
-- site still rendered, silently serving mock data instead of the database.
--
-- Server-side order creation failed the same way: service_role bypasses RLS,
-- but it does NOT bypass grants.
--
-- Grants are written out explicitly per table rather than via ALTER DEFAULT
-- PRIVILEGES on purpose — a future table should have to opt in to public
-- readability, not inherit it silently.

-- ============================================================
-- Catalog: read-only for the public roles. The init migration's SELECT
-- policies still narrow this to active rows only.
-- ============================================================
grant select on table
  public.products,
  public.product_images,
  public.colours,
  public.sizes,
  public.straps_handles,
  public.addons,
  public.product_colours,
  public.product_sizes,
  public.product_straps_handles,
  public.product_addons
to anon, authenticated;

-- ============================================================
-- orders / order_items: deliberately NO grant to anon or authenticated.
-- Those roles are now refused at the privilege level, before RLS is even
-- consulted — belt and braces alongside the zero-policy default-deny.
-- ============================================================

-- ============================================================
-- service_role — the server-only path (src/lib/supabase/admin.ts) used by
-- order creation, seeding, and any future admin tooling.
-- ============================================================
grant select, insert, update, delete on table
  public.products,
  public.product_images,
  public.colours,
  public.sizes,
  public.straps_handles,
  public.addons,
  public.product_colours,
  public.product_sizes,
  public.product_straps_handles,
  public.product_addons,
  public.orders,
  public.order_items
to service_role;
