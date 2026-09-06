-- Rand's confirmed size rules, strap/chain names+pricing, and the Mini Luna
-- photo-mapping resolution (all "Luna" folders = Mini Luna). Loco sizes
-- remain intentionally absent — not yet confirmed.

-- Real size names.
insert into public.sizes (name)
values ('Regular'), ('Medium'), ('Large'), ('Small')
on conflict (name) do nothing;

-- Real strap/chain names, confirmed +5 JOD each (option_upgrade_defaults
-- already has strap=5, chain=5 — these per-row price_delta values match it
-- explicitly rather than relying on the default silently, since a real
-- catalog row should carry its own confirmed price).
insert into public.straps_handles (name, type)
values
  ('Crochet Strap', 'strap'),
  ('Silver Tone Chain', 'chain'),
  ('Gold Tone Chain', 'chain')
on conflict (name) do update set type = excluded.type;

-- Product <-> size links.
-- Nova: Regular (default), Medium +5, Large +5.
-- Vault: Regular (default), Large +5.
-- Mini Luna: Regular (default), Small +0 (explicitly free — do not price this).
-- Loco: none — unresolved, per instruction.
insert into public.product_sizes (product_id, size_id, price_delta, sort_order)
select p.id, s.id, x.price_delta, x.sort_order
from (values
  ('nova', 'Regular', 0, 1),
  ('nova', 'Medium', 5, 2),
  ('nova', 'Large', 5, 3),
  ('vault', 'Regular', 0, 1),
  ('vault', 'Large', 5, 2),
  ('mini-luna', 'Regular', 0, 1),
  ('mini-luna', 'Small', 0, 2)
) as x(product_slug, size_name, price_delta, sort_order)
join public.products p on p.slug = x.product_slug
join public.sizes s on s.name = x.size_name
on conflict (product_id, size_id) do update set
  price_delta = excluded.price_delta,
  sort_order = excluded.sort_order,
  active = true;

-- Product <-> strap/chain links. All four products support all three
-- confirmed options, each +5 JOD (matches the original "ALL products
-- support straps, chains" rule from the real-data brief).
insert into public.product_straps_handles (product_id, strap_handle_id, price_delta, sort_order)
select p.id, sh.id, 5, x.sort_order
from (values
  ('nova', 'Crochet Strap', 1), ('nova', 'Silver Tone Chain', 2), ('nova', 'Gold Tone Chain', 3),
  ('vault', 'Crochet Strap', 1), ('vault', 'Silver Tone Chain', 2), ('vault', 'Gold Tone Chain', 3),
  ('mini-luna', 'Crochet Strap', 1), ('mini-luna', 'Silver Tone Chain', 2), ('mini-luna', 'Gold Tone Chain', 3),
  ('loco', 'Crochet Strap', 1), ('loco', 'Silver Tone Chain', 2), ('loco', 'Gold Tone Chain', 3)
) as x(product_slug, option_name, sort_order)
join public.products p on p.slug = x.product_slug
join public.straps_handles sh on sh.name = x.option_name
on conflict (product_id, strap_handle_id) do update set
  price_delta = excluded.price_delta,
  sort_order = excluded.sort_order,
  active = true;

-- Mini Luna colour links — every "Luna" Drive folder is now confirmed to
-- mean Mini Luna, and several already exist in the shared colours catalog
-- (created for Nova: Silver, Gold, Black, and the two-tone "Silver & Gold"
-- — reused here rather than duplicated, since it's the same real
-- combination regardless of which product's photo folder it was named
-- from — "Luna Gold & Silver" and Nova's "Silver & Gold" are the same
-- two-tone colourway). Red was already linked to Mini Luna previously.
insert into public.product_colours (product_id, colour_id, sort_order)
select p.id, c.id, x.sort_order
from (values
  ('mini-luna', 'Silver', 2),
  ('mini-luna', 'Gold', 3),
  ('mini-luna', 'Black', 4),
  ('mini-luna', 'Silver & Gold', 5)
) as x(product_slug, colour_name, sort_order)
join public.products p on p.slug = x.product_slug
join public.colours c on c.name = x.colour_name
on conflict (product_id, colour_id) do update set sort_order = excluded.sort_order, active = true;
