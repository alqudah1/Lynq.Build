-- 3D asset architecture. No real GLB files exist yet for any of the four
-- real products — this migration only builds the tables/relationships so
-- real assets can be linked in later without another schema change. See
-- docs/3d-assets.md for the full node-naming contract every GLB must follow.

create table public.model_assets (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('body', 'strap', 'chain', 'handle', 'hardware')),
  name text not null,
  glb_url text not null,
  format text not null default 'glb' check (format in ('glb', 'gltf')),
  -- true for the DEVELOPMENT-ONLY placeholder geometry used to prove the
  -- viewer pipeline (see public/models/dev/) — never linked to a real
  -- product's product_models row, and repository.ts must never surface a
  -- placeholder asset to the live storefront.
  is_placeholder boolean not null default false,
  version integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.model_assets is
  'One row per GLB/GLTF file: a bag body, a strap, a chain, a handle, or a hardware piece. is_placeholder marks development-only test geometry — never real product art.';

alter table public.model_assets enable row level security;

create policy "public can read active non-placeholder model assets"
  on public.model_assets for select
  to anon, authenticated
  using (active = true and is_placeholder = false);

-- product <-> body model, optionally scoped to a specific size (a size
-- variant needing different geometry, not just a scaled-up standard model).
-- size_id null = the default/standard body for that product.
create table public.product_models (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  size_id uuid references public.sizes(id) on delete cascade,
  model_asset_id uuid not null references public.model_assets(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.product_models is
  'Links a product (optionally a specific size variant) to its 3D body model_asset. No rows exist yet for the four real products — none have approved production geometry.';

-- Partial unique indexes rather than a single UNIQUE(product_id, size_id):
-- Postgres treats every NULL as distinct in a plain unique constraint, which
-- would silently allow multiple "default" (size_id null) rows per product.
create unique index product_models_default_unique
  on public.product_models (product_id)
  where size_id is null and active = true;
create unique index product_models_size_unique
  on public.product_models (product_id, size_id)
  where size_id is not null and active = true;

alter table public.product_models enable row level security;

create policy "public can read active product models"
  on public.product_models for select
  to anon, authenticated
  using (
    active = true
    and exists (select 1 from public.products p where p.id = product_models.product_id and p.active = true)
  );

-- Strap/handle/chain 3D asset reference. Nullable: the strap/chain option
-- catalog (straps_handles) is currently empty for the real products (no real
-- names yet) — this column is ready for the moment both the name AND a real
-- GLB exist.
alter table public.straps_handles add column model_asset_id uuid references public.model_assets(id) on delete set null;
comment on column public.straps_handles.model_asset_id is
  'The 3D asset (kind=strap/handle/chain matching this row''s type) to attach at the body model''s attach_* node. Null until a real GLB exists for this option.';

-- Colour material reference for the 3D viewer, alongside the existing
-- hex_value (display/fallback colour) and swatch_image_url (photographed
-- reference). Nullable — most real colours have neither a hex nor a
-- material reference yet.
alter table public.colours add column material_ref text;
comment on column public.colours.material_ref is
  'Identifier for a real material/texture (e.g. a yarn/crochet texture set) the 3D viewer should apply for this colour, once one exists. Null = fall back to a flat hex tint (or the neutral placeholder if hex is also null).';
