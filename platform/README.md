# LYNQ Core Platform

The foundation the rest of the LYNQ platform (Authentication, Organizations, Workspaces, Brain, Agent Registry, Workflows, and beyond) will be built on. This is Module 1: Application Shell + Database Foundation only — no auth, no tenancy, no business features yet.

This app is entirely separate from the `lynq.build` marketing site that lives at the repository root: its own `package.json`, its own Vercel project, its own Neon database, its own deployment pipeline. Nothing here imports from, depends on, or can affect the marketing site.

## Stack

- Next.js (App Router, TypeScript) — scaffolded via the current stable `create-next-app`, no manual structural overrides.
- Tailwind CSS v4 (CSS-first configuration — no `tailwind.config.ts`; see `src/app/globals.css`).
- Drizzle ORM + `@neondatabase/serverless` (Neon's HTTP driver) for database access.
- Neon Postgres, provisioned through the Vercel Marketplace.
- Vitest for tests.

## LYNQ design tokens

Brand values (colors, fonts) are defined as plain CSS custom properties in `src/app/globals.css`, under the `--lynq-*` prefix — deliberately independent of Tailwind's own configuration, so they remain valid regardless of how Tailwind itself is set up later. Tailwind's `@theme inline` block consumes these tokens; it does not define them.

## Local setup

```bash
npm install
cp .env.example .env.local
# Fill in .env.local with real Neon connection strings (see below)
npm run dev
```

Visit `http://localhost:3000/health` — it should report `database: "connected"` if your local `.env.local` points at a real, reachable Neon database.

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon's **pooled** connection string. Used by the running application at request time. |
| `DATABASE_URL_UNPOOLED` | Neon's **direct** connection string. Used only by `drizzle-kit` for migrations — DDL is not reliable over a pooled connection. |

Both are validated at request time (not at build time) by `src/lib/env.ts`, using `zod`. Validation is server-only — `env.ts` imports the `server-only` package, which makes it a build-time error to import this module from a client component. If either variable is missing or invalid, `loadEnv()` throws a typed `EnvValidationError`; callers (the health route/page) catch it and return a generic, safe error — full detail is logged server-side only, never returned to the client.

**In deployed environments**, both variables are set as **Vercel Sensitive Environment Variables** on this platform's own, separate Vercel project — never committed to the repository, never set on the marketing site's project.

**In CI** (GitHub Actions), both variables are set directly in `.github/workflows/ci.yml` as non-secret, syntactically-valid placeholder values pointing at nothing real (`*.invalid` hostnames). This is safe because the current test suite mocks the database client entirely — no test in Module 1 makes a real network call — so CI never needs, and never receives, real credentials.

## Database migrations

Schema lives in `src/db/schema.ts`. As of Module 1, it defines no tables — it exists only so Drizzle's tooling has a valid module to import. The workflow, once real tables exist (starting Module 2):

```bash
npm run db:generate   # reads schema.ts, writes a new SQL migration into drizzle/
# review the generated SQL by hand
git add drizzle/ src/db/schema.ts
git commit -m "..."
npm run db:migrate    # applies pending migrations against DATABASE_URL_UNPOOLED
```

Migrations are **never** applied with `drizzle-kit push` against production — every schema change is a reviewed, committed SQL file applied deliberately via `db:migrate`. Once the first migration exists, `npm run db:check` (`drizzle-kit check`) is added to CI to catch schema/migration drift.

## Health check

- `GET /api/health` — JSON. `{"status":"ok","database":"connected"}` (200) on success; a generic non-200 response otherwise. Dynamic on every request (`export const dynamic = "force-dynamic"`), never cached.
- `/health` — the same check, rendered as a simple human-readable page. Also forced dynamic.

Both run a real `SELECT 1` against the database on every single request, with a 5-second timeout (via `AbortSignal.timeout`, which actually cancels the underlying HTTP request rather than just abandoning a promise). Neither response ever includes a connection string, hostname, SQL text, driver error message, or stack trace — only the status shape above. Full error detail is written to server-side logs (`console.error`) only.

## Deployment

This app is deployed as its **own, independent Vercel project** (root directory set to `platform/`), linked to its own Neon database. It is not linked to, and cannot trigger a deploy of, the existing `lynq-build` Vercel project that serves the marketing site.

```bash
cd platform
vercel link      # creates/links a NEW project — never run from the repo root
vercel deploy    # preview
vercel deploy --prod   # production, once ready
```

Sensitive environment variables (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`) are configured directly in this Vercel project's dashboard settings as **Sensitive Environment Variables**, not via `.env` files, and not shared with any other Vercel project in this workspace.

## Testing

```bash
npm run test        # single run
npm run test:watch  # watch mode
```

Module 1's tests cover: the health check's success path returns the approved minimal shape; a database failure returns a generic non-200 response; sensitive error detail (connection strings, hostnames, credentials) never appears in any returned response, even when the underlying error contains it; and environment validation fails clearly, listing every missing key, when required configuration is absent.
