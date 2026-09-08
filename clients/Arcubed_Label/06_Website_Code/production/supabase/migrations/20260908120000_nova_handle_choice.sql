-- Nova: handle choice. Confirmed by Rand, 2026-09-08.
--
-- The customer chooses WITH HANDLE or WITHOUT HANDLE and BOTH stay at the
-- product's JOD 55 base price. price_delta is 0 on purpose: this is a
-- configuration choice, not an upgrade, and pricing it would be inventing a
-- commercial rule the client did not state.
--
-- This closes the long-standing "Nova handle" question in
-- docs/3d-production/PRODUCT-GEOMETRY-MAP.md row 5, which was UNRESOLVED
-- because a photograph can show whether ONE Nova has a handle but never
-- whether every Nova does. It is now a selectable option, so both
-- configurations are real.
--
-- NOTE: no photography is mapped to either option yet. The configurator must
-- not imply a visual difference until Rand supplies images of both.

insert into public.straps_handles (name, type)
values
  ('With Handle', 'handle'),
  ('Without Handle', 'handle')
on conflict (name) do update set type = excluded.type;

insert into public.product_straps_handles (product_id, strap_handle_id, price_delta, sort_order)
select p.id, sh.id, 0, x.sort_order
from (values
  ('nova', 'With Handle', 1),
  ('nova', 'Without Handle', 2)
) as x(product_slug, option_name, sort_order)
join public.products p on p.slug = x.product_slug
join public.straps_handles sh on sh.name = x.option_name
on conflict (product_id, strap_handle_id) do update
  set price_delta = excluded.price_delta,
      sort_order  = excluded.sort_order;
