-- Arcubed Label — production schema (Phase 1: catalog + order foundation).
-- No accounts/auth, no Stripe yet. Catalog is public-read-only for active rows;
-- orders have no public policies at all — order creation happens exclusively
-- through a server-side path using the service_role key (see src/lib/orders.ts).

-- ============================================================
-- updated_at helper
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- CATALOG TABLES
-- ============================================================

create table public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  base_price numeric(10, 2) not null check (base_price >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  image_url text not null,
  image_type text not null default 'gallery', -- e.g. 'front' | 'back' | 'detail' | 'gallery'
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index product_images_product_id_idx on public.product_images (product_id);

create table public.colours (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  hex_value text not null,
  swatch_image_url text,
  active boolean not null default true
);

create table public.sizes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  active boolean not null default true
);

create table public.straps_handles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('strap', 'handle')),
  image_url text,
  active boolean not null default true
);

create table public.addons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  image_url text,
  active boolean not null default true
);

-- ============================================================
-- PRODUCT <-> OPTION relationship tables.
-- Each carries price_delta + active + product-specific availability.
-- compatible_colour_ids: null = compatible with every colour the product
-- offers (the common case); a non-null array restricts it to those colour
-- ids. Mirrors the frontend's optional StrapOption/HandleOption/AddonOption
-- .compatibleWith field exactly, so the repository layer maps 1:1.
-- ============================================================

create table public.product_colours (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  colour_id uuid not null references public.colours (id) on delete restrict,
  price_delta numeric(10, 2) not null default 0,
  active boolean not null default true,
  sort_order integer not null default 0,
  unique (product_id, colour_id)
);

create index product_colours_product_id_idx on public.product_colours (product_id);

create table public.product_sizes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  size_id uuid not null references public.sizes (id) on delete restrict,
  price_delta numeric(10, 2) not null default 0,
  -- Per-product context line, e.g. "Fits a 13" laptop" — the same global
  -- Size ("Medium") means something different per bag, so this lives on the
  -- join row, not on sizes itself.
  note text,
  active boolean not null default true,
  sort_order integer not null default 0,
  unique (product_id, size_id)
);

create index product_sizes_product_id_idx on public.product_sizes (product_id);

create table public.product_straps_handles (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  strap_handle_id uuid not null references public.straps_handles (id) on delete restrict,
  price_delta numeric(10, 2) not null default 0,
  active boolean not null default true,
  sort_order integer not null default 0,
  compatible_colour_ids uuid[],
  unique (product_id, strap_handle_id)
);

create index product_straps_handles_product_id_idx on public.product_straps_handles (product_id);

create table public.product_addons (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  addon_id uuid not null references public.addons (id) on delete restrict,
  price_delta numeric(10, 2) not null default 0,
  active boolean not null default true,
  sort_order integer not null default 0,
  compatible_colour_ids uuid[],
  unique (product_id, addon_id)
);

create index product_addons_product_id_idx on public.product_addons (product_id);

-- ============================================================
-- ORDERS — no accounts yet, so orders are keyed by order_number / email only.
-- No public RLS policies at all: writes happen through the server-side
-- service_role path (src/lib/orders.ts), which bypasses RLS by design.
-- ============================================================

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'in_production', 'ready_to_ship', 'shipped', 'delivered', 'cancelled')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'paid', 'refunded', 'failed')),
  subtotal numeric(10, 2) not null check (subtotal >= 0),
  shipping_amount numeric(10, 2) not null default 0 check (shipping_amount >= 0),
  total numeric(10, 2) not null check (total >= 0),
  currency text not null default 'usd',
  shipping_address jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create index orders_email_idx on public.orders (customer_email);
create index orders_status_idx on public.orders (status);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  -- Deliberately ON DELETE SET NULL, not CASCADE: an order must keep showing
  -- what the customer actually bought even if the product is later removed
  -- from the catalog. product_name_snapshot/configuration_snapshot are the
  -- source of truth for what was purchased; product_id is just a convenience
  -- link back to the still-existing product, when there is one.
  product_id uuid references public.products (id) on delete set null,
  product_name_snapshot text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  -- { colourId, colourName, sizeId, sizeLabel, strapId, strapLabel, handleId,
  --   handleLabel, addonIds: [{id, label, priceDelta}], ... } — exactly what
  -- the customer configured, independent of whatever the product looks like
  -- later.
  configuration_snapshot jsonb not null,
  -- Optional serialized preview state (e.g. which layered image/colour combo
  -- was shown), for order-detail display once real photography exists.
  preview_snapshot jsonb,
  created_at timestamptz not null default now()
);

create index order_items_order_id_idx on public.order_items (order_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.colours enable row level security;
alter table public.sizes enable row level security;
alter table public.straps_handles enable row level security;
alter table public.addons enable row level security;
alter table public.product_colours enable row level security;
alter table public.product_sizes enable row level security;
alter table public.product_straps_handles enable row level security;
alter table public.product_addons enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Catalog: public (anon + authenticated) may READ active rows only.
-- No insert/update/delete policies anywhere in this migration — catalog
-- writes happen via service_role (seeding now, an admin tool later), which
-- bypasses RLS entirely. There is deliberately no public write path.

create policy "public can read active products"
  on public.products for select
  to anon, authenticated
  using (active = true);

create policy "public can read images of active products"
  on public.product_images for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = product_images.product_id and p.active = true
    )
  );

create policy "public can read active colours"
  on public.colours for select
  to anon, authenticated
  using (active = true);

create policy "public can read active sizes"
  on public.sizes for select
  to anon, authenticated
  using (active = true);

create policy "public can read active straps_handles"
  on public.straps_handles for select
  to anon, authenticated
  using (active = true);

create policy "public can read active addons"
  on public.addons for select
  to anon, authenticated
  using (active = true);

create policy "public can read active product_colours of active products"
  on public.product_colours for select
  to anon, authenticated
  using (
    active = true
    and exists (
      select 1 from public.products p
      where p.id = product_colours.product_id and p.active = true
    )
  );

create policy "public can read active product_sizes of active products"
  on public.product_sizes for select
  to anon, authenticated
  using (
    active = true
    and exists (
      select 1 from public.products p
      where p.id = product_sizes.product_id and p.active = true
    )
  );

create policy "public can read active product_straps_handles of active products"
  on public.product_straps_handles for select
  to anon, authenticated
  using (
    active = true
    and exists (
      select 1 from public.products p
      where p.id = product_straps_handles.product_id and p.active = true
    )
  );

create policy "public can read active product_addons of active products"
  on public.product_addons for select
  to anon, authenticated
  using (
    active = true
    and exists (
      select 1 from public.products p
      where p.id = product_addons.product_id and p.active = true
    )
  );

-- orders / order_items: intentionally NO policies for anon/authenticated.
-- RLS is enabled with zero grants, which default-denies every row to those
-- roles. Only the service_role key (server-only, see src/lib/supabase/admin.ts)
-- can read or write these tables, which is exactly the "controlled
-- server-side path" the order-creation flow requires.
