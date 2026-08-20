# byoot/ — foundation scaffold

This is the first build step for the BYOOT engagement, per
`BYOOT_TRANSFORMATION_PLAN.md` (repo root) and
`LYNQ_ENGINEERING_STANDARD.md` Part F. Before touching anything here, read:

1. `BYOOT_AUDIT.md` — what the client's existing codebase actually does
2. `clients/BYOOT/01_Client_Info/BYOOT_DATA_CONSTRAINTS.md` — the compliance rules this scaffold is built against
3. `BYOOT_TRANSFORMATION_PLAN.md` Sections A and C — the architecture and compliance-by-design decisions this scaffold implements

**No external resources exist yet.** No Vercel project, no Neon database,
no env values. Nothing in this scaffold has been deployed or run against a
real database. Everything below that says "not runnable yet" is not
runnable yet — that's expected, not a bug.

## What works right now, with zero setup

```
npm install
npm run typecheck
npm test          # unit tests only — no database needed
npm run build
```

All four should pass. See the bottom of this file for what each one
actually proves.

## What you need to create manually, in order

### 1. A Neon project (separate from `platform/`'s)

Per `LYNQ_ENGINEERING_STANDARD.md` Part F: no shared database with
`platform/` or anything else. Create a new Neon project for BYOOT.

**Do not point this at anything you'd call "production" yet.** Per
`BYOOT_TRANSFORMATION_PLAN.md`'s hard rule and this scaffold's own design,
no real TRREB/PropTx data should ever land in any database this repo talks
to — every environment stays synthetic-data-only until the compliance
questions in the transformation plan's Assumption Register are actually
resolved with the client.

From the Neon project, you'll get one pooled and one direct connection
string for Neon's default role — used for two different purposes below,
**neither of which is `DATABASE_URL`** (see the ownership warning in step
2 before wiring these up as you might expect from a simpler project).

### 2. THREE Postgres roles, not two — this is the part that actually matters

**Correction, recorded here rather than silently fixed:** an earlier draft
of these instructions said "whatever Neon gives you by default is fine"
for the normal app role, with migrations running as that same role over
`DATABASE_URL_UNPOOLED`. That's wrong, in a way that would have made the
whole isolation design a no-op: **a Postgres table owner bypasses RLS and
ignores `REVOKE` entirely — ownership isn't a grant that can be revoked.**
The role that runs `drizzle-kit migrate` creates `listings_vow` and
therefore owns it. If that's also the role `DATABASE_URL` authenticates
as, the app's "normal" connection can read `listings_vow` regardless of
any RLS policy or `REVOKE ALL` statement — not because something is
misconfigured, but because ownership is a stronger, separate permission
that those don't touch. `scripts/verify-vow.mjs`'s role-separation check
(step 3) would have caught this the first time anyone actually ran it
against a real database — see `docs/adr/0001-vow-tier-isolation.md` for
the full record.

So: **three roles**, not two.

1. **The migration/owner role** — Neon's default role is fine here. Used
   **only** for `DATABASE_URL_UNPOOLED`. Never used to serve the running
   application.
2. **The app role** — a NEW role you create explicitly, granted ordinary
   read/write on `users`, `sessions`, `audit_logs`, `rate_limit_counters`,
   and `listings` — and explicitly **not** the table owner of anything, so
   it has no ownership bypass to worry about. This is what `DATABASE_URL`
   authenticates as.
3. **`vow_reader`** — granted `SELECT` on `listings_vow` only, via the RLS
   policy already defined in `schema.ts`. This is what
   `DATABASE_URL_VOW_READER` authenticates as.

After running migrations (`npm run db:generate && npm run db:migrate`,
using Neon's default role over `DATABASE_URL_UNPOOLED`), run this once, by
hand, against the database:

```sql
-- The app role: ordinary access to everything except listings_vow, and
-- explicitly NOT an owner of anything (CREATE ROLE never makes it one).
CREATE ROLE byoot_app LOGIN PASSWORD '<a real generated password>';
GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions, audit_logs, rate_limit_counters, listings TO byoot_app;
REVOKE ALL ON listings_vow FROM byoot_app;
REVOKE ALL ON listings_vow FROM PUBLIC;

-- vow_reader: read-only on listings_vow, matching schema.ts's RLS policy.
CREATE ROLE vow_reader LOGIN PASSWORD '<a different real generated password>';
GRANT SELECT ON listings_vow TO vow_reader;
```

Take the **pooled** connection string for `byoot_app` → `DATABASE_URL`.
Take the **pooled** connection string for `vow_reader` (pooled, same
reasoning as `DATABASE_URL`: read at request time from `getVowData()`,
not a migration path) → `DATABASE_URL_VOW_READER`.

Both must be genuinely different roles from each other AND from whatever
ran the migration. `src/lib/env.ts` refuses to proceed if `DATABASE_URL`
and `DATABASE_URL_VOW_READER` are textually identical — but that check
cannot catch two different connection strings that happen to authenticate
as the same role (or as the table owner). `npm run verify:vow`'s step 3
is what actually proves the roles are distinct and that ownership isn't
silently defeating everything above — see below.

### 3. A Vercel project (when you're ready to deploy)

Not needed for local dev. When it's time: a new Vercel project, sibling to
`platform/`'s, root directory set to `byoot/`. Not done as part of this
scaffold.

### Now run `npm run verify:vow`

This is the completion criterion for everything above — not a separate,
optional check.

```
set -a; source .env.local; set +a   # or export the three DATABASE_URL* vars however you normally do
npm run verify:vow
```

One command: applies migrations, seeds synthetic data
(`src/db/seed-data.ts` — never real data), and runs
`vow-gate.integration.test.ts` — the actually-adversarial test that
connects with the *normal* role and tries to read `listings_vow` directly,
bypassing `getVowData()` entirely. It fails loudly and non-zero if any
step fails, if the required env vars are missing, if
`DATABASE_URL_VOW_READER` turns out to equal `DATABASE_URL`, or if it
can't find explicit evidence in the test output that assertions actually
ran and passed — see `scripts/verify-vow.mjs`'s own comments for exactly
what "loudly" means here. **If this command doesn't print `PASSED` at the
end, the role separation isn't configured correctly yet, regardless of
what the application code does or what any other command reports.**

## Deliberate scope decisions in this pass — not gaps, but worth naming

- **No OAuth login flow.** `src/lib/auth/session.ts` and `cookies.ts` are
  copied from `platform/` and fully functional — session creation,
  validation, expiry, revocation. What's *not* here is the Google/Microsoft
  OAuth callback flow (`platform/src/lib/auth/{providers,callback,state,
  account-linking}.ts`), because that requires real OAuth app credentials
  this task didn't ask for, and copying ~1,500 lines of security-sensitive
  flow code I can't test against a real provider felt like a worse outcome
  than being explicit about the gap. `requireAuthenticatedUser()` and the
  VOW gate both work today against a session created directly via
  `createSession()` — which is also exactly how `platform/`'s own tests
  exercise auth without live OAuth, so the tests in this scaffold are not
  a lesser proof, just a narrower one. Add the OAuth flow (copied from
  `platform/`, same Part F rule) when real provider credentials exist.
- **No styling framework.** `platform/` uses Tailwind v4; this scaffold
  doesn't include it yet, to keep the first build minimal. `ListingCard`
  is deliberately unstyled beyond bare layout. Add Tailwind (or whatever
  the brand direction from Phase 2 of the transformation plan calls for)
  when real design work starts — don't treat the current markup as a
  preview of anything.
- **`trebb-sync.ts` is a stub.** Structure and design notes only, no live
  HTTP calls. See that file's comments for what's already decided and why.
- **No `accounts` table.** Follows from the no-OAuth-yet decision above —
  add it back (matching `platform/`'s shape) when OAuth is wired up.

## What running everything actually proves

- `npm run typecheck` — the whole scaffold compiles, including that
  `ListingCard`'s `brokerageName` prop is genuinely required (try removing
  it from `src/app/page.tsx`'s usage and re-run this — it fails).
- `npm test` — the VOW gate's *application-layer* logic is correct
  (`vow-gate.test.ts`, mocked, no DB) and `ListingCard` renders brokerage
  attribution (`ListingCard.test.tsx`) and the seed data generator actually
  produces the required messy edge cases (`seed-data.test.ts`).
- `npm run build` — Next.js can produce a production build of the scaffold
  as it stands.
- `npm run verify:vow` (not runnable yet — no database exists) — once a
  database and the two Postgres roles above exist, this is the command
  that actually proves the VOW gate holds at the database level,
  independent of the application code, and refuses to report success on
  anything less than real, positive evidence. This is the one that matters
  most and the one this scaffold cannot prove on its own — see
  `src/lib/listings/vow-gate.integration.test.ts` and
  `scripts/verify-vow.mjs`'s own comments, and
  `docs/adr/0001-vow-tier-isolation.md` for why the design is shaped the
  way it is.
