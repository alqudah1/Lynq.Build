-- Same gap as 20260830005544_grant_table_privileges.sql, for the three new
-- settings tables added in 20260902120000: RLS policies exist, but Postgres
-- also requires an explicit GRANT before a role may touch a table at all —
-- without it, every read failed with 42501 "permission denied", caught by
-- repository.ts and silently degrading to null/[] rather than crashing, but
-- still not showing the real DB-backed values on the live site.

grant select on table
  public.store_settings,
  public.shipping_rules,
  public.option_upgrade_defaults
to anon, authenticated;

grant select, insert, update, delete on table
  public.store_settings,
  public.shipping_rules,
  public.option_upgrade_defaults
to service_role;
