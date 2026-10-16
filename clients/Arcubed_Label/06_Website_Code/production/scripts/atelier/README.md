# Testing against a private local database

The review site (arcubed-review.vercel.app) uses the LIVE Supabase project, so
anything that writes (placing an order, publishing a colour) must not be tested
there. Instead, run a throwaway copy of the database on your own machine:

- **PGlite** (Postgres compiled to WebAssembly, `@electric-sql/pglite` +
  `@electric-sql/pglite-socket`), with every file in `supabase/migrations`
  applied in order. That includes the real catalogue seed, so prices, colours
  and options match the migrations.
- **PostgREST** (v14, the REST server Supabase uses), with
  `db-prepared-statements = false` and `db-pool = 1` (PGlite multiplexes one
  connection).
- A small proxy that serves it at `http://127.0.0.1:54321/rest/v1`, and keys
  signed with a local secret for `anon` and `service_role`.
- A local-only SQL door on `127.0.0.1:54322` (POST a query) that the tests use
  for assertions.

`scripts/atelier/local-db.mjs` runs it. The tools are not project
dependencies: install them anywhere and point at them.

```
# 0. once: npm i @electric-sql/pglite @electric-sql/pglite-socket in some folder,
#    and download a PostgREST v12+ binary (github.com/PostgREST/postgrest/releases)
# 1. start the local database (applies every migration on first run;
#    writes .local-db/env.local with the URL and keys)
PGLITE_DIR=… POSTGREST_BIN=… node scripts/atelier/local-db.mjs --reset
# 2. point the app at it: .env.local gets the URL and the two local keys
#    (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
#     SUPABASE_SERVICE_ROLE_KEY) plus ARCUBED_ADMIN_PASSPHRASE=<any local value>
npm run build && npx next start -p 4312
# 3. run the end-to-end test (refuses anything but localhost + the local DB)
PLAYWRIGHT=… BASE=http://localhost:4312 PASSFILE=… YARN=… node scripts/atelier/e2e-local.mjs
```

`e2e-local.mjs` creates a test colour, measures and calibrates it, approves
it, confirms the supplier and publishes it to Nova. It then buys it (Cash on
Delivery), edits the cart line, checks the order row, confirmation page and
admin order, takes the colour off sale, and checks checkout refuses it.

The other suites (`scripts/test-*.mjs`, `scripts/webkit/*.mjs`) run against
any base URL. `test-checkout-e2e.mjs` and `webkit/wk-checkout.mjs` without
`SKIP_ORDER=1` place a real order, so point them only at a local server.
