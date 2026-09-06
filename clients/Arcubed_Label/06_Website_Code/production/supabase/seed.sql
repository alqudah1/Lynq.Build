-- ============================================================
-- ARCUBED LABEL — DEVELOPMENT / MOCK SEED DATA ONLY.
--
-- This is the same placeholder catalog the approved prototype shipped with
-- (Rosa Tote, Luna Crossbody, Mira Mini Bag, Coco Market Bag) — NOT Rand's
-- real product catalog. Do not present this data to the client or in
-- production as real inventory. Replace/remove once real product
-- information, pricing, and photography are supplied.
--
-- Run via `supabase db reset` (local) or `psql -f supabase/seed.sql` against
-- a dev project. Uses fixed UUIDs + ON CONFLICT so it's safe to re-run.
--
-- CURRENT STATE: this seed has already been run against the live, connected
-- Arcubed Supabase project (ref fnswiyxjbsabomktqizr). Every "product" a
-- storefront read returns right now is this mock catalog, not Rand's real
-- inventory — see supabase/client-data-template/README.md and
-- clients/Arcubed_Label/01_Client_Info/product-matrix.md for the real-data
-- replacement path.
-- ============================================================

-- ---------- colours (shared palette) ----------
insert into public.colours (id, name, hex_value, active) values
  ('00000000-0000-0000-0000-000000000001', 'Terracotta', '#C97B5A', true),
  ('00000000-0000-0000-0000-000000000002', 'Sage',       '#8FA187', true),
  ('00000000-0000-0000-0000-000000000003', 'Blush',      '#E8B4B8', true),
  ('00000000-0000-0000-0000-000000000004', 'Cream',      '#EFE3D3', true),
  ('00000000-0000-0000-0000-000000000005', 'Charcoal',   '#3B3630', true),
  ('00000000-0000-0000-0000-000000000006', 'Mustard',    '#D9A441', true)
on conflict (id) do nothing;

-- ---------- sizes (global labels; per-product note/price on product_sizes) ----------
insert into public.sizes (id, name, active) values
  ('10000000-0000-0000-0000-000000000001', 'Extra Small', true),
  ('10000000-0000-0000-0000-000000000002', 'Small', true),
  ('10000000-0000-0000-0000-000000000003', 'Medium', true),
  ('10000000-0000-0000-0000-000000000004', 'Large', true)
on conflict (id) do nothing;

-- ---------- straps / handles ----------
insert into public.straps_handles (id, name, type, active) values
  ('20000000-0000-0000-0000-000000000001', 'Woven Strap', 'strap', true),
  ('20000000-0000-0000-0000-000000000002', 'Braided Strap', 'strap', true),
  ('20000000-0000-0000-0000-000000000003', 'Chain Strap', 'strap', true),
  ('20000000-0000-0000-0000-000000000004', 'Short Handle', 'handle', true),
  ('20000000-0000-0000-0000-000000000005', 'Long Handle', 'handle', true)
on conflict (id) do nothing;

-- ---------- add-ons ----------
insert into public.addons (id, name, active) values
  ('30000000-0000-0000-0000-000000000001', 'Gold Charm', true),
  ('30000000-0000-0000-0000-000000000002', 'Tassel', true),
  ('30000000-0000-0000-0000-000000000003', 'Zip Pouch', true),
  ('30000000-0000-0000-0000-000000000004', 'Monogram', true)
on conflict (id) do nothing;

-- ---------- products ----------
insert into public.products (id, slug, name, description, base_price, active, sort_order) values
  ('40000000-0000-0000-0000-000000000001', 'rosa-tote', 'Rosa Tote', 'Structured, roomy, everyday.', 120, true, 1),
  ('40000000-0000-0000-0000-000000000002', 'luna-crossbody', 'Luna Crossbody', 'Small, sculpted, hands-free.', 95, true, 2),
  ('40000000-0000-0000-0000-000000000003', 'mira-mini', 'Mira Mini Bag', 'A little colour, everywhere you go.', 68, true, 3),
  ('40000000-0000-0000-0000-000000000004', 'coco-market', 'Coco Market Bag', 'Oversized, breezy, market-ready.', 140, true, 4)
on conflict (id) do nothing;

-- ---------- Rosa Tote: all 6 colours, 3 sizes, 3 straps, 4 addons ----------
insert into public.product_colours (product_id, colour_id, sort_order) values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 1),
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 2),
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 3),
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', 4),
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005', 5),
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000006', 6)
on conflict (product_id, colour_id) do nothing;

insert into public.product_sizes (product_id, size_id, price_delta, note, sort_order) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 0, 'Fits an iPad + essentials', 1),
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 15, 'Fits a 13" laptop', 2),
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 30, 'Everyday carry-all', 3)
on conflict (product_id, size_id) do nothing;

insert into public.product_straps_handles (product_id, strap_handle_id, price_delta, sort_order) values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 0, 1),
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 12, 2),
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 18, 3)
on conflict (product_id, strap_handle_id) do nothing;

insert into public.product_addons (product_id, addon_id, price_delta, sort_order) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 8, 1),
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 6, 2),
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 15, 3),
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000004', 10, 4)
on conflict (product_id, addon_id) do nothing;

-- ---------- Luna Crossbody: 5 colours, 2 sizes, 2 straps, 3 addons ----------
insert into public.product_colours (product_id, colour_id, sort_order) values
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 1),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 2),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', 3),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000005', 4),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000006', 5)
on conflict (product_id, colour_id) do nothing;

insert into public.product_sizes (product_id, size_id, price_delta, note, sort_order) values
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 0, 'Phone, cards, keys', 1),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', 10, 'Adds room for sunglasses', 2)
on conflict (product_id, size_id) do nothing;

insert into public.product_straps_handles (product_id, strap_handle_id, price_delta, sort_order) values
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 0, 1),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', 18, 2)
on conflict (product_id, strap_handle_id) do nothing;

insert into public.product_addons (product_id, addon_id, price_delta, sort_order) values
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 8, 1),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 6, 2),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000004', 10, 3)
on conflict (product_id, addon_id) do nothing;

-- ---------- Mira Mini Bag: 4 colours, 2 sizes, no straps/handles, 2 addons ----------
insert into public.product_colours (product_id, colour_id, sort_order) values
  ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003', 1),
  ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 2),
  ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000006', 3),
  ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 4)
on conflict (product_id, colour_id) do nothing;

insert into public.product_sizes (product_id, size_id, price_delta, note, sort_order) values
  ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 0, 'Just the essentials', 1),
  ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 8, 'A little extra room', 2)
on conflict (product_id, size_id) do nothing;

insert into public.product_addons (product_id, addon_id, price_delta, sort_order) values
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', 8, 1),
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002', 6, 2)
on conflict (product_id, addon_id) do nothing;

-- ---------- Coco Market Bag: 4 colours, 2 sizes, handles (not straps), 2 addons ----------
insert into public.product_colours (product_id, colour_id, sort_order) values
  ('40000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004', 1),
  ('40000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002', 2),
  ('40000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 3),
  ('40000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000005', 4)
on conflict (product_id, colour_id) do nothing;

insert into public.product_sizes (product_id, size_id, price_delta, note, sort_order) values
  ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003', 0, 'A day at the market', 1),
  ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', 20, 'Beach + travel days', 2)
on conflict (product_id, size_id) do nothing;

insert into public.product_straps_handles (product_id, strap_handle_id, price_delta, sort_order) values
  ('40000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', 0, 1),
  ('40000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000005', 10, 2)
on conflict (product_id, strap_handle_id) do nothing;

insert into public.product_addons (product_id, addon_id, price_delta, sort_order) values
  ('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000003', 15, 1),
  ('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000004', 10, 2)
on conflict (product_id, addon_id) do nothing;
