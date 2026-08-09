-- Brain Module 6 — seeds the eight fixed domains' management metadata.
-- Descriptions are quoted directly from marketing/LYNQ_BRAIN.md §2 (Core
-- Principles / domain list), not paraphrased or invented. sort_order
-- matches that document's own listed order, identical to the
-- knowledge_domain enum's declaration order in src/db/schema.ts.
-- owner_department is left NULL for every row: MODULE_3_BRAIN_ARCHITECTURE.md
-- §15 Open Question #2 explicitly states the domain-to-department mapping
-- is "not confirmed, needs an explicit Founder's Office decision" — seeding
-- a fabricated mapping here would misrepresent unconfirmed data as settled
-- fact. ON CONFLICT DO NOTHING makes this safe to re-run (idempotent),
-- matching this task's "safely backfill" instruction; it never overwrites
-- a row that already exists, whether from a prior partial run or a future
-- hand-edit.
INSERT INTO knowledge_domain_metadata (id, domain, description, sort_order, owner_department, is_retired, retired_at, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'identity', 'Company, Brand, Vision, Principles. The most stable domain in the Brain; almost everything else is judged against it, and it almost never judges itself against anything else.', 1, NULL, false, NULL, now(), now()),
  (gen_random_uuid(), 'offerings', 'Products, Services, Pricing, Design System. What the company actually sells and how it''s built — the domain every client- and product-facing decision has to stay consistent with.', 2, NULL, false, NULL, now(), now()),
  (gen_random_uuid(), 'market', 'Clients, Leads, Partners, Competitive Intelligence, Research. Everything the company knows about the world outside itself: who it serves, who it''s courting, who it competes with, and what''s changing.', 3, NULL, false, NULL, now(), now()),
  (gen_random_uuid(), 'execution', 'Projects, Tasks, SOPs, Engineering knowledge, Documentation. How work actually gets done — the operational domain that changes the most often and is expected to.', 4, NULL, false, NULL, now(), now()),
  (gen_random_uuid(), 'growth', 'Marketing, Sales, Content. How the company finds and earns attention and revenue.', 5, NULL, false, NULL, now(), now()),
  (gen_random_uuid(), 'governance', 'Legal, Finance, HR, Security. The domain with the least room for improvisation — errors here are disproportionately expensive, and this domain''s knowledge is held to the highest verification standard in the whole Brain.', 6, NULL, false, NULL, now(), now()),
  (gen_random_uuid(), 'capability', 'AI Agents, Templates. The company''s reusable tools for doing work — an agent''s instructions and track record, and the reusable patterns (briefs, frameworks, formats) that don''t need to be reinvented per project.', 7, NULL, false, NULL, now(), now()),
  (gen_random_uuid(), 'wisdom', 'Lessons Learned, Experiments, Retrospective knowledge. Deliberately its own domain rather than scattered across the others, because this is the domain that makes the whole Brain compound instead of just accumulate — it is where a mistake becomes a permanent asset instead of a private memory.', 8, NULL, false, NULL, now(), now())
ON CONFLICT (domain) DO NOTHING;
