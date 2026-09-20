-- Production time 3–5 -> 5–7 days, at the client's request (2026-09-19).
--
-- 20260902120200_seed_real_arcubed_catalog.sql upserts store_settings and
-- overwrites these three columns, so without this migration a re-run of the
-- seed would put production time back to 3–5. The seed stays as it was — it
-- is history — and this is the later word on it.
--
-- Production TIME only. Shipping and delivery estimates are separate:
-- ready_for_delivery_fulfillment_label ("Next day") is untouched.
update public.store_settings
set production_time_min_days = 5,
    production_time_max_days = 7,
    production_time_label = '5–7 days'
where id = 1;
