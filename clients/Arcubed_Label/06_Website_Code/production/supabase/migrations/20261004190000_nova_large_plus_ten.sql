-- Nova Large is JOD 65, not 60 — confirmed directly by Rand (2026-10-04).
--
-- 20260903090000_update_confirmed_size_strap_chain_and_luna_colours.sql
-- seeded Nova as Regular +0, Medium +5, Large +5, which priced Medium and
-- Large the same. Nova is base 55 with Regular +0 (55), Medium +5 (60),
-- Large +10 (65). That migration stays as it was — it is history — and this
-- is the later word on it.
--
-- Nova Large only. Mini Luna's two sizes are both JOD 50 on purpose (the
-- size difference is small — same confirmation), and Vault Large stays +5.
update public.product_sizes ps
set price_delta = 10
from public.products p, public.sizes s
where ps.product_id = p.id
  and ps.size_id = s.id
  and p.slug = 'nova'
  and s.name = 'Large';
