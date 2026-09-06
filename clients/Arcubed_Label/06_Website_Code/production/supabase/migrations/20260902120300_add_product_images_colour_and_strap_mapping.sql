-- Real photography mapping architecture: product_images can now be scoped to
-- a specific colourway and, optionally, a specific strap/handle/chain
-- variation (e.g. "Gold Nova with Handle" is colour_id=Gold, strap_handle_id
-- pointing at whichever handle option that photo shows). Both nullable: null
-- colour_id/strap_handle_id means a general product shot not tied to either.
-- No rows are populated by this migration — real photography has not been
-- imported yet (client Drive folders not yet processed). This only makes the
-- mapping structure ready to receive it without another schema change.
alter table public.product_images add column colour_id uuid references public.colours(id) on delete cascade;
alter table public.product_images add column strap_handle_id uuid references public.straps_handles(id) on delete cascade;

comment on column public.product_images.colour_id is
  'Which colourway this photo shows. Null = a general product shot not specific to one colour.';
comment on column public.product_images.strap_handle_id is
  'Which strap/handle/chain variation this photo shows (if any). Null = not specific to one.';
