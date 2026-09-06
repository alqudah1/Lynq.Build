-- Return/exchange policy, per order type. Configurable data, not hardcoded
-- copy — see docs and repository.ts's getReturnPolicies(). Rand's real
-- rule: custom/made-to-order is final sale; ready-for-delivery terms are
-- still being decided (historically returnable when items were in-stock,
-- but no exact rule confirmed for the new site yet). A legal/defect
-- exception always applies to both — this table structurally cannot
-- represent an absolute "no returns ever" policy: exceptions_summary is
-- NOT NULL and always rendered alongside is_returnable.
create table public.return_policies (
  order_type text primary key check (order_type in ('custom', 'ready_for_delivery')),
  -- null = not yet confirmed / still configurable. false = confirmed final
  -- sale. true = confirmed returnable (within return_window_days once that
  -- is also set).
  is_returnable boolean,
  -- null = unresolved. Never invent a number here.
  return_window_days integer check (return_window_days is null or return_window_days > 0),
  policy_summary text not null,
  exceptions_summary text not null,
  updated_at timestamptz not null default now()
);

comment on table public.return_policies is
  'Return/exchange policy per order type. is_returnable/return_window_days null = not yet confirmed by Rand — show policy_summary + exceptions_summary as-is, never infer a rule. exceptions_summary must always be shown regardless of is_returnable — defect/damage/wrong-item/legal-rights exceptions are never waived.';

alter table public.return_policies enable row level security;

create policy "public can read return policies"
  on public.return_policies for select
  to anon, authenticated
  using (true);

grant select on table public.return_policies to anon, authenticated;
grant select, insert, update, delete on table public.return_policies to service_role;

insert into public.return_policies (order_type, is_returnable, return_window_days, policy_summary, exceptions_summary)
values
  (
    'custom',
    false,
    null,
    'Custom, made-to-order bags are final sale — we don''t offer change-of-mind returns or exchanges once an order is placed.',
    'This doesn''t apply to a defective item, a damaged item, an incorrect item, or any rights you have under applicable consumer law — those are always honoured regardless of order type.'
  ),
  (
    'ready_for_delivery',
    null,
    null,
    'Return/exchange terms for Ready for Delivery items are still being finalized — check back soon, or contact us directly.',
    'This doesn''t apply to a defective item, a damaged item, an incorrect item, or any rights you have under applicable consumer law — those are always honoured regardless of order type.'
  )
on conflict (order_type) do update set
  is_returnable = excluded.is_returnable,
  return_window_days = excluded.return_window_days,
  policy_summary = excluded.policy_summary,
  exceptions_summary = excluded.exceptions_summary,
  updated_at = now();
