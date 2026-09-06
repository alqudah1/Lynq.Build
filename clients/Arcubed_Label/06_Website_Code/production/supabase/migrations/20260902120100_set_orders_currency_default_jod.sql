-- Arcubed's confirmed currency is JOD. Previously defaulted to 'usd', an
-- assumption from before the client's real data was available.
alter table public.orders alter column currency set default 'jod';
