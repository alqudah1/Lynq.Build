-- How the customer pays, recorded per order.
--
-- Cash on Delivery is the store's live payment method — Rand, 2026-10: "I
-- would keep it cliq or cash on delivery". CliQ is approved in principle but
-- has no alias or destination yet, so the schema knows the value and checkout
-- refuses it (src/lib/payment.ts) until those details exist.
--
-- payment_status is untouched and still records whether money has arrived:
-- a Cash on Delivery order is 'unpaid' when it is placed and only becomes
-- 'paid' when Rand marks it so in /admin/orders.
--
-- Nullable with no default on purpose. Orders placed before this column
-- existed never declared a method, and back-filling them would invent one.
alter table public.orders
  add column if not exists payment_method text
    check (payment_method in ('cash_on_delivery', 'cliq'));

comment on column public.orders.payment_method is
  'How the customer pays: cash_on_delivery (live) or cliq (not offered until a destination exists). Null on orders placed before 2026-10-05.';

notify pgrst, 'reload schema';
