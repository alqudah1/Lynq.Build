grant select on table
  public.model_assets,
  public.product_models
to anon, authenticated;

grant select, insert, update, delete on table
  public.model_assets,
  public.product_models
to service_role;
