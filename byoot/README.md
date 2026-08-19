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

From the Neon project, you'll get:
- A pooled connection string → `DATABASE_URL`
- A direct/unpooled connection string → `DATABASE_URL_UNPOOLED`

### 2. Two Postgres roles — this is the part that actually matters

The VOW gate's database-level enforcement (`src/db/schema.ts`,
`BYOOT_TRANSFORMATION_PLAN.md` Section C) depends on **two distinct
Postgres roles**, not one shared role with an app-level `if`:

1. **The normal app role** (whatever Neon gives your `DATABASE_URL` by
   default is fine) — must have **no grant** on `listings_vow`.
2. **A `vow_reader` role** — must have `SELECT` on `listings_vow` only.

After running migrations (`npm run db:generate && npm run db:migrate`,
once `DATABASE_URL_UNPOOLED` is set), run this once, by hand, against the
database (the RLS policy itself is defined in `schema.ts` and will be
created by the migration — this part, the role and its connection string,
Drizzle can't do for you):

```sql
CREATE ROLE vow_reader LOGIN PASSWORD '<a real generated password>';
GRANT SELECT ON listings_vow TO vow_reader;
REVOKE ALL ON listings_vow FROM PUBLIC;
-- Confirm your normal app role has no grant on listings_vow — if you
-- created it before this step, explicitly revoke:
REVOKE ALL ON listings_vow FROM <your normal app role>;
```

Take the connection string for that role (same host/database, different
user/password) → `DATABASE_URL_VOW_READER`.

**Verify it, don't assume it.** Once this exists, `npm run test:integration`
runs `src/lib/listings/vow-gate.integration.test.ts` — the actually-
adversarial test that connects with the *normal* role and tries to read
`listings_vow` directly, bypassing `getVowData()` entirely. It should fail
to read anything. If that test doesn't fail the read, the role separation
isn't actually configured correctly yet, regardless of what the
application code does.

### 3. Seed synthetic data

```
npm run seed
```

Inserts 300 synthetic listings (`src/db/seed-data.ts`) plus VOW records for
the ones marked "Sold." Never real data — see that file's own comments for
the messy-real-world cases it deliberately includes.

### 4. A Vercel project (when you're ready to deploy)

Not needed for local dev. When it's time: a new Vercel project, sibling to
`platform/`'s, root directory set to `byoot/`. Not done as part of this
scaffold.

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
- `npm run test:integration` (not runnable yet) — once a database and the
  two Postgres roles above exist, this is the test that actually proves
  the VOW gate holds at the database level, independent of the application
  code. This is the one that matters most and the one this scaffold cannot
  prove on its own — see `src/lib/listings/vow-gate.integration.test.ts`'s
  own comments.
