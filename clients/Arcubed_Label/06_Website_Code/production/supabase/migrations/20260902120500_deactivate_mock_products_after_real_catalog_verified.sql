-- Real catalog (Nova, Vault, Mini Luna, Loco) verified end-to-end against
-- production build + real DB (2026-09-02) — see repository.ts's header
-- comment. Mock products are deactivated, not deleted: supabase/seed.sql's
-- dev fixture stays fully intact for local development/tests, this just
-- hides the mock rows that were previously live-seeded into THIS project
-- from the real storefront.
update public.products
set active = false, updated_at = now()
where slug in ('rosa-tote', 'luna-crossbody', 'mira-mini', 'coco-market');
