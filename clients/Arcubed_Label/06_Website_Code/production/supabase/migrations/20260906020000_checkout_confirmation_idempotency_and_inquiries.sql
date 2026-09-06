-- Checkout support: confirmation tokens, idempotency, quote-required shipping,
-- and contact inquiry persistence. Forward-only.
alter table public.orders
  add column if not exists confirmation_token uuid not null default gen_random_uuid();
create unique index if not exists orders_confirmation_token_key
  on public.orders (confirmation_token);

alter table public.orders
  add column if not exists idempotency_key text;
create unique index if not exists orders_idempotency_key_key
  on public.orders (idempotency_key)
  where idempotency_key is not null;

alter table public.orders
  add column if not exists shipping_quote_required boolean not null default false;
comment on column public.orders.shipping_quote_required is
  'True for destinations outside Jordan, where the rate depends on country and has not been confirmed. shipping_amount stays 0 and total excludes shipping until Arcubed quotes it.';

create table if not exists public.contact_inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  email text not null check (length(trim(email)) between 3 and 200),
  topic text not null check (length(trim(topic)) between 1 and 80),
  message text not null check (length(trim(message)) between 1 and 4000),
  status text not null default 'new' check (status in ('new', 'read', 'resolved')),
  created_at timestamptz not null default now()
);
comment on table public.contact_inquiries is
  'Messages from the site contact form. Written only by the server (service_role) after validation — the anon key has no insert grant, so the form cannot be used to write arbitrary rows directly.';
alter table public.contact_inquiries enable row level security;
revoke all on table public.contact_inquiries from anon, authenticated;
grant select, insert, update, delete on table public.contact_inquiries to service_role;
