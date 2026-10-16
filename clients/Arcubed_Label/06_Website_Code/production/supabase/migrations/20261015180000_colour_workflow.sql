-- Colour workflow: from a supplier yarn photograph to a published, orderable
-- colour (admin /admin/colours). See docs/colour-workflow.md.
--
-- ADD -> UPLOAD REFERENCE -> CALIBRATE -> PREVIEW -> REVIEW -> APPROVE
--     -> ASSIGN BAGS -> (supplier confirmed) -> PUBLISH
--
-- Nothing in this table is visible to customers or orderable. A colour becomes
-- orderable ONLY through publish_colour_candidate(), which writes the existing
-- catalogue tables (colours + product_colours) exactly as the seeded catalogue
-- does, and only for a candidate that is approved AND confirmed available.
-- Approval and publication are separate actions by design.
--
-- Access: service role only (the admin's server actions). RLS is enabled with
-- no policies, and anon/authenticated have no privileges at all.
--
-- Safe to apply to a live database: one new table, two new functions, no
-- change to any existing table, row or policy.

create table public.colour_candidates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  -- the yarn's material: a colour can only be offered on bags of the same
  -- material (metallic raffia: Nova, Mini Luna; matte cord: Vault; fringe
  -- cord: Loco). Recolouring changes colour, never material.
  material_family text not null check (material_family in ('metallic-raffia', 'matte-cord', 'fringe-cord')),
  -- Rand's photograph of the yarn, resized in the browser (a WebP data URL,
  -- or JPEG from Safari, which cannot encode WebP).
  reference_image text check (
    reference_image is null
    or ((reference_image like 'data:image/webp;base64,%' or reference_image like 'data:image/jpeg;base64,%')
        and octet_length(reference_image) <= 700000)
  ),
  -- where on the photograph the yarn was measured, and what was measured:
  -- {"x":0.3,"y":0.3,"w":0.4,"h":0.4,"lab":[L,a,b],"pixels":n}
  measurement jsonb,
  measured_hex text check (measured_hex is null or measured_hex ~ '^#[0-9a-f]{6}$'),
  -- the calibrated yarn colour customers will see (measured, optionally
  -- adjusted in lightness / strength / hue); calibration records the adjustment
  hex_value text check (hex_value is null or hex_value ~ '^#[0-9a-f]{6}$'),
  calibration jsonb not null default '{"dL":0,"chroma":1,"hue":0}'::jsonb,
  product_slugs text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'rejected')),
  review_note text check (review_note is null or char_length(review_note) <= 500),
  approved_by text check (approved_by is null or char_length(btrim(approved_by)) between 1 and 60),
  approved_at timestamptz,
  -- Rand has confirmed her supplier can provide this yarn
  supplier_confirmed boolean not null default false,
  supplier_note text check (supplier_note is null or char_length(supplier_note) <= 300),
  published_colour_id uuid references public.colours (id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint colour_candidates_approval_complete check (
    status <> 'approved' or (approved_by is not null and approved_at is not null and hex_value is not null)
  )
);

create unique index colour_candidates_name_material_key on public.colour_candidates (lower(btrim(name)), material_family);

create or replace function public.colour_candidates_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger colour_candidates_touch before update on public.colour_candidates
  for each row execute function public.colour_candidates_touch();

alter table public.colour_candidates enable row level security;
revoke all on table public.colour_candidates from anon, authenticated;
grant select, insert, update, delete on table public.colour_candidates to service_role;

-- PUBLISH. Atomic: the colour row and every bag's availability are written
-- together or not at all. The server action has already checked material
-- and the photograph's lightness limit for each bag; this function enforces
-- what must never be bypassed.
create or replace function public.publish_colour_candidate(p_candidate uuid, p_product_ids uuid[])
returns uuid
language plpgsql
as $$
declare
  c public.colour_candidates%rowtype;
  existing public.colours%rowtype;
  v_colour uuid;
  pid uuid;
  v_sort integer;
begin
  select * into c from public.colour_candidates where id = p_candidate for update;
  if not found then raise exception 'Colour not found.'; end if;
  if c.status <> 'approved' then raise exception 'Only an approved colour can be published.'; end if;
  if not c.supplier_confirmed then raise exception 'Confirm the yarn is available from the supplier before publishing.'; end if;
  if c.hex_value is null then raise exception 'The colour has no calibrated colour code.'; end if;
  if p_product_ids is null or coalesce(array_length(p_product_ids, 1), 0) = 0 then
    raise exception 'Choose at least one bag.';
  end if;

  if c.published_colour_id is not null then
    v_colour := c.published_colour_id;
    update public.colours set hex_value = c.hex_value, active = true where id = v_colour;
  else
    select * into existing from public.colours where lower(name) = lower(btrim(c.name));
    if found then
      -- The same yarn already in the catalogue on another bag: reuse it, but
      -- never silently change what an existing colour means.
      if existing.is_two_tone then
        raise exception 'A two-tone colour is already called %. Rename this colour.', existing.name;
      end if;
      if existing.hex_value is not null and lower(existing.hex_value) <> c.hex_value then
        raise exception 'A colour called % already exists with a different colour code (%). Rename this colour, or match it.', existing.name, existing.hex_value;
      end if;
      update public.colours set hex_value = coalesce(existing.hex_value, c.hex_value), active = true where id = existing.id;
      v_colour := existing.id;
    else
      insert into public.colours (name, hex_value, active, is_two_tone)
      values (btrim(c.name), c.hex_value, true, false)
      returning id into v_colour;
    end if;
  end if;

  foreach pid in array p_product_ids loop
    perform 1 from public.products where id = pid and active;
    if not found then raise exception 'Bag % is not an active product.', pid; end if;
    select coalesce(max(sort_order), 0) + 1 into v_sort from public.product_colours where product_id = pid;
    insert into public.product_colours (product_id, colour_id, price_delta, active, sort_order)
    values (pid, v_colour, 0, true, v_sort)
    on conflict (product_id, colour_id) do update set active = true;
  end loop;

  update public.colour_candidates
    set published_colour_id = v_colour, published_at = now()
    where id = p_candidate;
  return v_colour;
end;
$$;

-- AVAILABILITY. Turn one colour on or off for one bag (product_colours.active,
-- the column the shop and checkout already obey). A bag always keeps at least
-- one colour.
create or replace function public.set_product_colour_active(p_product uuid, p_colour uuid, p_active boolean)
returns void
language plpgsql
as $$
declare
  remaining integer;
begin
  if not p_active then
    select count(*) into remaining from public.product_colours
      where product_id = p_product and active and colour_id <> p_colour;
    if remaining = 0 then raise exception 'A bag must keep at least one colour.'; end if;
  end if;
  update public.product_colours set active = p_active where product_id = p_product and colour_id = p_colour;
  if not found then raise exception 'That colour is not assigned to that bag.'; end if;
end;
$$;

revoke all on function public.publish_colour_candidate(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.set_product_colour_active(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.colour_candidates_touch() from public, anon, authenticated;
grant execute on function public.publish_colour_candidate(uuid, uuid[]) to service_role;
grant execute on function public.set_product_colour_active(uuid, uuid, boolean) to service_role;
