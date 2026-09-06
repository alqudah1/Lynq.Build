-- Ready for Delivery: Rand's in-stock, already-made bags — a separate
-- storefront experience from the made-to-order customizer catalog. Each
-- item references the real product/colour/size/strap/chain catalog (so it
-- stays consistent with the customizer's data, not a parallel free-text
-- copy of it) plus an optional human description override, real photos,
-- price, and stock count.

create table public.ready_for_delivery_items (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  title text not null,
  colour_id uuid references public.colours(id) on delete restrict,
  secondary_colour_id uuid references public.colours(id) on delete restrict,
  size_id uuid references public.sizes(id) on delete restrict,
  strap_id uuid references public.straps_handles(id) on delete restrict,
  chain_id uuid references public.straps_handles(id) on delete restrict,
  -- Optional human-readable override/summary of the exact configuration —
  -- the frontend composes a description from the FKs above when this is
  -- null. Present as its own field because the item "needs an actual
  -- colour/configuration description" per spec, distinct from the
  -- structured references.
  configuration_description text,
  price numeric not null check (price >= 0),
  quantity_available integer not null default 0 check (quantity_available >= 0),
  -- Publish/unpublish, independent of stock depletion — Rand can unpublish
  -- without losing the quantity count, and a quantity of 0 doesn't require
  -- unpublishing (see the "stop being purchasable" behavior below).
  active boolean not null default true,
  -- Explicit per spec, even though this table's rows are always ready-for-
  -- delivery by construction (no made-to-order rows ever live here).
  ready_for_delivery boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.ready_for_delivery_items is
  'In-stock, already-made bags Rand can list for next-day delivery. Separate from the made-to-order customizer catalog (products/product_colours/etc.) by design — a ready item is a fixed physical bag, not a live configuration. quantity_available = 0 means "stop being purchasable", not "delete" — historical orders referencing this row must keep working (see order_items.ready_for_delivery_item_id, ON DELETE SET NULL).';

alter table public.ready_for_delivery_items enable row level security;

-- Publicly visible when active, REGARDLESS of quantity_available — a
-- sold-out item should still render (as unavailable), not disappear, so a
-- customer isn't left with a dead link and Rand can still see it listed.
-- Purchasability (quantity_available > 0) is an application-layer check.
create policy "public can read active ready-for-delivery items"
  on public.ready_for_delivery_items for select
  to anon, authenticated
  using (active = true);

create table public.ready_for_delivery_item_images (
  id uuid primary key default gen_random_uuid(),
  ready_for_delivery_item_id uuid not null references public.ready_for_delivery_items(id) on delete cascade,
  image_url text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.ready_for_delivery_item_images is
  'Real photos of one physical ready-for-delivery item. No rows exist yet — no ready inventory has been uploaded.';

alter table public.ready_for_delivery_item_images enable row level security;

create policy "public can read images of active ready-for-delivery items"
  on public.ready_for_delivery_item_images for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.ready_for_delivery_items r
      where r.id = ready_for_delivery_item_images.ready_for_delivery_item_id and r.active = true
    )
  );

grant select on table public.ready_for_delivery_items, public.ready_for_delivery_item_images to anon, authenticated;
grant select, insert, update, delete on table public.ready_for_delivery_items, public.ready_for_delivery_item_images to service_role;

-- order_items extended to reference EITHER a made-to-order product OR a
-- ready-for-delivery item, never both — item_kind is the discriminator,
-- enforced by a check constraint so a row can't be ambiguous about which
-- kind of purchase it represents.
alter table public.order_items add column ready_for_delivery_item_id uuid references public.ready_for_delivery_items(id) on delete set null;
alter table public.order_items add column item_kind text not null default 'made_to_order' check (item_kind in ('made_to_order', 'ready_for_delivery'));
alter table public.order_items add constraint order_items_kind_reference_check check (
  (item_kind = 'made_to_order' and ready_for_delivery_item_id is null)
  or
  (item_kind = 'ready_for_delivery' and ready_for_delivery_item_id is not null)
);

comment on column public.order_items.item_kind is
  'Discriminates a made-to-order line (product_id-based, full configuration_snapshot) from a ready-for-delivery line (ready_for_delivery_item_id-based, the exact physical item that was purchased). ON DELETE SET NULL on both product_id and ready_for_delivery_item_id means a later catalog change never breaks an existing order — configuration_snapshot is still the source of truth for what was actually bought.';

-- Fulfillment lead time is a store-wide, confirmed fact for both order
-- types — made-to-order's is already in store_settings
-- (production_time_label); ready-for-delivery's confirmed value ("next
-- day", Rand's own words) belongs alongside it for the same reason
-- (single DB source of truth, not hardcoded per component).
alter table public.store_settings add column ready_for_delivery_fulfillment_label text not null default 'Next day';
