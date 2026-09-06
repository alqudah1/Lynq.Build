-- DEVELOPMENT-ONLY placeholder geometry (see public/models/dev/*.glb) used
-- solely to prove the 3D viewer pipeline end-to-end. is_placeholder=true
-- means the "public can read active non-placeholder model assets" RLS
-- policy excludes these from anon/authenticated reads — only service_role
-- (the internal dev-test route, via createAdminClient()) can see them.
-- Never linked to any real product via product_models.
insert into public.model_assets (kind, name, glb_url, is_placeholder, version, active)
values
  ('body', 'DEV TEST — placeholder bag body', '/models/dev/dev-test-bag.glb', true, 1, true),
  ('strap', 'DEV TEST — placeholder strap', '/models/dev/dev-test-strap.glb', true, 1, true),
  ('chain', 'DEV TEST — placeholder chain', '/models/dev/dev-test-chain.glb', true, 1, true);
