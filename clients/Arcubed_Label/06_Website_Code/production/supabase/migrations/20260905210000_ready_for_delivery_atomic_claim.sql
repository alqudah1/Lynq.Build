-- Ready for Delivery: atomic stock claim + release.
--
-- PROBLEM: src/lib/orders.ts validates quantity_available before creating an
-- order but never decrements it. Two concurrent checkouts for the last bag
-- both pass validation and both succeed. Validation without a claim is not
-- stock control.
--
-- FIX: a conditional UPDATE. Postgres takes a row lock for the duration of
-- the UPDATE, so a second concurrent caller blocks, then re-evaluates its
-- WHERE clause against the already-decremented value and matches zero rows.
-- Returning the row count lets the caller tell "claimed" from "someone beat
-- me to it" without a second read (which would itself be racy).
--
-- WHEN TO CLAIM: at order creation. There is no payment integration in this
-- system today, so order creation IS the commitment point — there is no
-- pending-payment window that would justify a separate reserve/confirm pair.
-- If a payment step is added later, split this into reserve -> fulfil and
-- expire stale reserves; do not add that machinery before it has a purpose.
--
-- Deliberately NOT built: reservation TTLs, backorders, per-customer holds.
-- Four hand-crocheted products do not need a warehouse system.

-- --------------------------------------------------------------------------
-- claim: decrement if and only if enough stock is available.
-- Returns 1 when the caller now owns the units, 0 when it does not.
-- --------------------------------------------------------------------------
create or replace function public.claim_ready_for_delivery_stock(
  p_item_id uuid,
  p_quantity integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed integer;
begin
  if p_quantity is null or p_quantity < 1 then
    raise exception 'claim_ready_for_delivery_stock: quantity must be >= 1, got %', p_quantity;
  end if;

  update public.ready_for_delivery_items
     set quantity_available = quantity_available - p_quantity,
         updated_at = now()
   where id = p_item_id
     and active = true
     and quantity_available >= p_quantity;

  get diagnostics v_claimed = row_count;
  return v_claimed;
end;
$$;

comment on function public.claim_ready_for_delivery_stock(uuid, integer) is
  'Atomically decrements a ready item''s stock. Returns 1 when the claim succeeded, 0 when the item is inactive or no longer has enough stock. Call during order creation, after pricing; abort the whole order when it returns 0. Pair with release_ready_for_delivery_stock if the order then fails to persist.';

-- --------------------------------------------------------------------------
-- release: give units back. Used as a compensating action when an order
-- fails to persist AFTER its stock was claimed. Intentionally does NOT check
-- `active` — an item unpublished between claim and failure must still have
-- its units returned, or stock leaks permanently.
-- --------------------------------------------------------------------------
create or replace function public.release_ready_for_delivery_stock(
  p_item_id uuid,
  p_quantity integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_released integer;
begin
  if p_quantity is null or p_quantity < 1 then
    raise exception 'release_ready_for_delivery_stock: quantity must be >= 1, got %', p_quantity;
  end if;

  update public.ready_for_delivery_items
     set quantity_available = quantity_available + p_quantity,
         updated_at = now()
   where id = p_item_id;

  get diagnostics v_released = row_count;
  return v_released;
end;
$$;

comment on function public.release_ready_for_delivery_stock(uuid, integer) is
  'Compensating action for a claim whose order failed to persist. Does not check active, so stock is never stranded on an unpublished item.';

-- --------------------------------------------------------------------------
-- Privileges. SECURITY DEFINER functions are executable by PUBLIC by default,
-- which would let the anon key mutate stock directly — revoke first, then
-- grant only to service_role (the server-only client in src/lib/supabase/admin.ts).
-- The table's own inline `check (quantity_available >= 0)` already prevents a
-- negative balance, so no extra constraint is added here.
-- --------------------------------------------------------------------------
revoke all on function public.claim_ready_for_delivery_stock(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_ready_for_delivery_stock(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_ready_for_delivery_stock(uuid, integer) to service_role;
grant execute on function public.release_ready_for_delivery_stock(uuid, integer) to service_role;
