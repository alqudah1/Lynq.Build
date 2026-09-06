-- Store-wide settings: currency + production lead time, client-confirmed.
insert into public.store_settings (id, currency_code, production_time_min_days, production_time_max_days, production_time_label)
values (1, 'JOD', 3, 5, '3–5 business days')
on conflict (id) do update set
  currency_code = excluded.currency_code,
  production_time_min_days = excluded.production_time_min_days,
  production_time_max_days = excluded.production_time_max_days,
  production_time_label = excluded.production_time_label,
  updated_at = now();

-- Shipping rules. International is quote-required — no rate was supplied.
insert into public.shipping_rules (zone_key, label, amount, currency_code, is_quote_required, sort_order)
values
  ('amman', 'Inside Amman', 3, 'JOD', false, 1),
  ('rest_of_jordan', 'Outside Amman', 5, 'JOD', false, 2),
  ('international', 'Worldwide', null, 'JOD', true, 3)
on conflict (zone_key) do update set
  label = excluded.label,
  amount = excluded.amount,
  currency_code = excluded.currency_code,
  is_quote_required = excluded.is_quote_required,
  sort_order = excluded.sort_order,
  updated_at = now();

-- Confirmed default upgrade price per customization category.
insert into public.option_upgrade_defaults (option_type, default_price_delta, currency_code)
values
  ('size', 5, 'JOD'),
  ('strap', 5, 'JOD'),
  ('chain', 5, 'JOD')
on conflict (option_type) do update set
  default_price_delta = excluded.default_price_delta,
  currency_code = excluded.currency_code,
  updated_at = now();

-- Real products. Base prices per client, in JOD.
insert into public.products (slug, name, description, base_price, active, sort_order)
values
  ('nova', 'Nova', null, 55, true, 1),
  ('vault', 'Vault', null, 50, true, 2),
  ('mini-luna', 'Mini Luna', null, 50, true, 3),
  ('loco', 'Loco', null, 65, true, 4)
on conflict (slug) do update set
  name = excluded.name,
  base_price = excluded.base_price,
  active = excluded.active,
  sort_order = excluded.sort_order,
  updated_at = now();

-- Real colourways, drawn from the client-supplied photography folder names.
-- hex_value intentionally left null (see column comment).
insert into public.colours (name, is_two_tone)
values
  ('Brown', false),
  ('Burgundy', false),
  ('Red', false),
  ('Gold', false),
  ('Black', false),
  ('Champagne', false),
  ('Silver', false),
  ('Rose Gold', false),
  ('Light Brown', false),
  ('Olive Green', false),
  ('Silver & Gold', true)
on conflict (name) do update set
  is_two_tone = excluded.is_two_tone;

-- Product <-> colour links. All colours free (price_delta 0, the column default).
insert into public.product_colours (product_id, colour_id, sort_order)
select p.id, c.id, x.sort_order
from (values
  ('loco', 'Brown', 1),
  ('loco', 'Burgundy', 2),
  ('mini-luna', 'Red', 1),
  ('nova', 'Gold', 1),
  ('nova', 'Black', 2),
  ('nova', 'Champagne', 3),
  ('nova', 'Silver', 4),
  ('nova', 'Rose Gold', 5),
  ('nova', 'Silver & Gold', 6),
  ('vault', 'Light Brown', 1),
  ('vault', 'Olive Green', 2),
  ('vault', 'Brown', 3)
) as x(product_slug, colour_name, sort_order)
join public.products p on p.slug = x.product_slug
join public.colours c on c.name = x.colour_name
on conflict (product_id, colour_id) do update set sort_order = excluded.sort_order, active = true;
