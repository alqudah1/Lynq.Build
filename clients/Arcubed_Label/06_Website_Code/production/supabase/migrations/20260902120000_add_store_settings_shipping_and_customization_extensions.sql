-- Store-wide settings (currency, production lead time) as a real singleton
-- row instead of hardcoded frontend constants.
create table public.store_settings (
  id smallint primary key default 1 check (id = 1),
  currency_code text not null,
  production_time_min_days integer not null check (production_time_min_days >= 0),
  production_time_max_days integer not null check (production_time_max_days >= production_time_min_days),
  production_time_label text not null,
  updated_at timestamptz not null default now()
);

comment on table public.store_settings is
  'Singleton (id always 1) holding store-wide, client-confirmed business facts. Never invent values here — leave a row absent or a field unresolved in application code rather than guessing.';

alter table public.store_settings enable row level security;

create policy "public can read store settings"
  on public.store_settings for select
  to anon, authenticated
  using (true);

-- Shipping rules per zone. amount is nullable + is_quote_required for zones
-- (e.g. international) where the client has not yet supplied a rate.
create table public.shipping_rules (
  id uuid primary key default gen_random_uuid(),
  zone_key text unique not null check (zone_key in ('amman', 'rest_of_jordan', 'international')),
  label text not null,
  amount numeric check (amount is null or amount >= 0),
  currency_code text not null,
  is_quote_required boolean not null default false,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.shipping_rules is
  'One row per shipping zone. amount is null + is_quote_required=true for zones with no confirmed rate yet (e.g. international) — the storefront must show a quote-required message for those, never compute an invented amount.';

alter table public.shipping_rules enable row level security;

create policy "public can read shipping rules"
  on public.shipping_rules for select
  to anon, authenticated
  using (true);

-- Confirmed default price deltas per customization category, so that real
-- size/strap/chain option names can be imported later referencing a single
-- authoritative number instead of the price being retyped per row.
create table public.option_upgrade_defaults (
  option_type text primary key check (option_type in ('size', 'strap', 'chain')),
  default_price_delta numeric not null check (default_price_delta >= 0),
  currency_code text not null,
  updated_at timestamptz not null default now()
);

comment on table public.option_upgrade_defaults is
  'Client-confirmed default upgrade price per customization category (e.g. every size upgrade is +5 JOD unless a specific option overrides it). Populated with real values only.';

alter table public.option_upgrade_defaults enable row level security;

create policy "public can read option upgrade defaults"
  on public.option_upgrade_defaults for select
  to anon, authenticated
  using (true);

-- Customization schema extensions for real Arcubed data.
alter table public.colours alter column hex_value drop not null;
alter table public.colours add column is_two_tone boolean not null default false;
alter table public.colours add constraint colours_name_key unique (name);

comment on column public.colours.hex_value is
  'Swatch hex code. Nullable: real Arcubed colourways do not have client-confirmed hex codes yet, only names from supplied photography. Do not invent an approximate hex — leave null until confirmed or a real swatch photo is available via swatch_image_url.';

alter table public.sizes add constraint sizes_name_key unique (name);

alter table public.straps_handles drop constraint straps_handles_type_check;
alter table public.straps_handles add constraint straps_handles_type_check
  check (type = any (array['strap'::text, 'handle'::text, 'chain'::text]));
alter table public.straps_handles add constraint straps_handles_name_key unique (name);
