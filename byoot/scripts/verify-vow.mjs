#!/usr/bin/env node
/**
 * npm run verify:vow — the moment-of-truth script.
 *
 * Runs migrations, seeds synthetic data, proves role separation actually
 * exists at the database level, and executes vow-gate.integration.test.ts
 * against a real database. Exists so proving the VOW boundary actually
 * holds is one command, not a remembered sequence of manual steps someone
 * eventually stops doing.
 *
 * Every step here is designed to fail LOUDLY and NON-ZERO, on purpose:
 *
 * 1. Env vars checked explicitly before anything runs — if
 *    DATABASE_URL / DATABASE_URL_UNPOOLED / DATABASE_URL_VOW_READER are
 *    missing, this exits 1 immediately with a specific message, rather
 *    than letting drizzle-kit or vitest fail later with a more confusing
 *    error (or, worse, not fail at all). The DATABASE_URL /
 *    DATABASE_URL_VOW_READER string-equality check here is a CHEAP
 *    PRE-FLIGHT, not the proof — it only catches the two connection
 *    strings being textually identical. It cannot catch two DIFFERENT
 *    strings that happen to authenticate as the SAME Postgres role, which
 *    defeats role separation just as completely without tripping a string
 *    comparison. That's what step 3 below is actually for.
 * 2. Each subprocess's exit code is checked; a non-zero exit from
 *    migration or seeding stops the run immediately — never proceeds to
 *    "run the tests anyway" against a database that isn't in the expected
 *    state.
 * 3. THE REAL PROOF: before the adversarial test suite even runs, this
 *    script itself connects directly with both DATABASE_URL and
 *    DATABASE_URL_VOW_READER, queries `current_user` on each, and asserts
 *    they are different roles — then asserts DATABASE_URL's role
 *    specifically gets a permission-denied error querying listings_vow
 *    directly. If either assertion fails, the script stops immediately
 *    with a message naming exactly which guarantee broke and why, not a
 *    generic thrown error — whoever hits this should not have to go read
 *    vow-gate.integration.test.ts to understand what's wrong.
 * 4. The integration test run's own output is parsed for an explicit
 *    "N passed" count greater than zero, with zero failed. This is
 *    deliberately stricter than just checking vitest's exit code: a
 *    misconfigured test filter, an accidentally-skipped test, or "no test
 *    files found" can all leave vitest exiting 0 in some configurations,
 *    which is exactly the failure mode named in the task that created
 *    this script — a broken boundary must never look green. If this
 *    script can't find clear evidence that real assertions actually ran
 *    and passed, it fails, even if the vitest process itself exited 0.
 *
 * Requires: env vars already present in process.env (export them, or
 * `set -a; source .env.local; set +a` first — see README.md).
 */
import { spawnSync } from "node:child_process";
import { neon } from "@neondatabase/serverless";

const REQUIRED_ENV_VARS = ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "DATABASE_URL_VOW_READER"];
const ADR_REF = "docs/adr/0001-vow-tier-isolation.md";

function fail(message) {
  console.error(`\n[verify:vow] FAILED — GUARANTEE BROKEN: ${message}\n`);
  process.exit(1);
}

function step(label, command, args) {
  console.log(`\n[verify:vow] → ${label} (${command} ${args.join(" ")})`);
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (result.error) {
    fail(`${label} could not be started: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${label} exited with status ${result.status}. Stopping — not proceeding to the next step.`);
  }
  return result;
}

// --- Step 0: refuse to proceed on missing configuration (cheap pre-flight, not proof) ---
const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key] || process.env[key].trim() === "");
if (missing.length > 0) {
  fail(
    `Missing required environment variable(s): ${missing.join(", ")}. ` +
      `No database is configured — this is not something verify:vow can proceed without. ` +
      `See byoot/README.md's manual database setup steps, then export these (or ` +
      `\`set -a; source .env.local; set +a\`) before running this again.`
  );
}
if (process.env.DATABASE_URL_VOW_READER === process.env.DATABASE_URL) {
  fail(
    "DATABASE_URL_VOW_READER is identical to DATABASE_URL (same connection string). This " +
      `defeats the role-separation design (see ${ADR_REF}) — refusing to run verify:vow ` +
      "against a misconfigured pair rather than produce a misleading green result. Note: this " +
      "check only catches identical strings. Two DIFFERENT connection strings that resolve to " +
      "the SAME Postgres role pass this check but are caught by step 3 below instead."
  );
}
console.log("[verify:vow] pre-flight passed: required env vars present, and the two connection strings are not textually identical.");

// --- Step 1: migrations -----------------------------------------------------
step("Running migrations", "npx", ["drizzle-kit", "migrate"]);

// --- Step 2: seed synthetic data --------------------------------------------
step("Seeding synthetic data", "npx", ["tsx", "src/db/seed.ts"]);

// --- Step 3: THE REAL PROOF — role separation actually exists at the database level ---
console.log("\n[verify:vow] → Verifying role separation at the database level (this is the real proof, not the env-var pre-flight)");

const publicSql = neon(process.env.DATABASE_URL);
const vowSql = neon(process.env.DATABASE_URL_VOW_READER);

let publicRole;
try {
  const rows = await publicSql`SELECT current_user`;
  publicRole = rows[0]?.current_user;
} catch (err) {
  fail(
    `Could not connect using DATABASE_URL to check current_user. The "public" client isn't even ` +
      `reachable, so nothing below could have been verified. Underlying error: ${err.message}`
  );
}

let vowRole;
try {
  const rows = await vowSql`SELECT current_user`;
  vowRole = rows[0]?.current_user;
} catch (err) {
  fail(
    `Could not connect using DATABASE_URL_VOW_READER to check current_user. The vow_reader ` +
      `client isn't even reachable — has the role been created yet? See byoot/README.md's ` +
      `"Two Postgres roles" section. Underlying error: ${err.message}`
  );
}

console.log(`[verify:vow]   DATABASE_URL authenticates as role:            "${publicRole}"`);
console.log(`[verify:vow]   DATABASE_URL_VOW_READER authenticates as role: "${vowRole}"`);

if (publicRole === vowRole) {
  fail(
    `DATABASE_URL and DATABASE_URL_VOW_READER are DIFFERENT connection strings that both ` +
      `authenticate as the SAME Postgres role ("${publicRole}"). This is the exact failure the ` +
      `env-var equality pre-flight (step 0) cannot catch: no shared secret, but no role ` +
      `separation either. Whatever RLS policy exists on listings_vow, BOTH clients get it — ` +
      `the vow_reader-only grant means nothing if both connection strings resolve to vow_reader, ` +
      `or if neither does and something else is granting access. This is precisely the guarantee ` +
      `${ADR_REF} depends on. Fix: create a genuinely separate Postgres role and confirm each ` +
      `connection string authenticates as the role you think it does — ` +
      `\`psql "$DATABASE_URL" -c "SELECT current_user"\` and the same for ` +
      `DATABASE_URL_VOW_READER, by hand, before touching this script again.`
  );
}
console.log("[verify:vow]   confirmed: the two connection strings authenticate as genuinely different Postgres roles.");

try {
  await publicSql`SELECT 1 FROM listings_vow LIMIT 1`;
  fail(
    `The public role ("${publicRole}" — the one DATABASE_URL authenticates as) was able to ` +
      `read listings_vow directly, with no session, no auth check, nothing. Expected a ` +
      `permission-denied / row-level-security error. Most likely cause: "${publicRole}" is the ` +
      `OWNER of listings_vow (i.e. it's the same role that ran migrations over ` +
      `DATABASE_URL_UNPOOLED) — table owners bypass RLS and REVOKE entirely, this is not a ` +
      `misconfigured grant, it's a structurally different problem (see ` +
      `docs/adr/0001-vow-tier-isolation.md's ownership section). Check with: ` +
      `\`psql "$DATABASE_URL_UNPOOLED" -c "SELECT tableowner FROM pg_tables WHERE tablename = ` +
      `'listings_vow'"\` and compare against \`SELECT current_user\` on DATABASE_URL. If they ` +
      `match, "${publicRole}" must never be used to run migrations again — provision a distinct ` +
      `byoot_app role per README.md's "THREE Postgres roles" section. Only if ownership checks ` +
      `out clean is this an ordinary grant/policy bug: RLS not enabled on listings_vow, the ` +
      `vow_reader policy scoped too broadly (e.g. \`TO public\` instead of \`TO vow_reader\`), ` +
      `or an explicit grant to "${publicRole}" that shouldn't exist — run ` +
      `\`REVOKE ALL ON listings_vow FROM PUBLIC\` and confirm role "${publicRole}" specifically ` +
      `has no grant, then re-run this.`
  );
} catch (err) {
  const msg = String(err?.message ?? err);
  if (!/permission denied|row-level security/i.test(msg)) {
    fail(
      `The public role's direct query against listings_vow failed, but NOT with the expected ` +
        `permission-denied / row-level-security error — got instead: "${msg}". This is not ` +
        `proof the boundary holds; it might mean the table doesn't exist yet (did migrations ` +
        `really apply?), a typo in the table name, or something else entirely. Investigate this ` +
        `specific error before trusting any result from this script.`
    );
  }
  console.log(`[verify:vow]   confirmed: the public role ("${publicRole}") is denied direct read access to listings_vow.`);
}

try {
  await vowSql`SELECT 1 FROM listings_vow LIMIT 1`;
  console.log(`[verify:vow]   confirmed: the vow_reader role ("${vowRole}") can itself read listings_vow — the policy isn't simply blocking everyone.`);
} catch (err) {
  fail(
    `The vow_reader role ("${vowRole}" — the one DATABASE_URL_VOW_READER authenticates as) ` +
      `cannot read listings_vow either. This is a DIFFERENT failure from the isolation ` +
      `guarantees above: it means nothing is proven by those passing, because the RLS policy ` +
      `or grant is broken for everyone, not selectively enforcing a boundary. Fix: check the ` +
      `vow_reader_select policy in src/db/schema.ts and the \`GRANT SELECT ON listings_vow TO ` +
      `vow_reader\` statement in byoot/README.md. Underlying error: ${err.message}`
  );
}

// --- Step 4: the adversarial application-level test suite -------------------
console.log("\n[verify:vow] → Running vow-gate.integration.test.ts against the real database");
const testResult = spawnSync("npx", ["vitest", "run", "--config", "vitest.integration.config.mts", "--reporter=verbose"], {
  encoding: "utf-8",
  env: process.env,
});
process.stdout.write(testResult.stdout ?? "");
process.stderr.write(testResult.stderr ?? "");

if (testResult.error) {
  fail(`Integration test run could not be started: ${testResult.error.message}`);
}

const combinedOutput = `${testResult.stdout ?? ""}\n${testResult.stderr ?? ""}`;

// vitest's own default summary line looks like: "Tests  5 passed (5)" or
// "Tests  3 passed | 2 failed (5)". Parsed deliberately strictly: any
// failed count > 0, or no matching "passed" count at all, is a failure —
// never assume success from an ambiguous or absent summary.
const failedMatch = combinedOutput.match(/Tests\s+(?:\d+\s+passed\s+\|\s+)?(\d+)\s+failed/);
const passedMatch = combinedOutput.match(/Tests\s+(\d+)\s+passed/);
const noTestFilesFound = /No test files found/i.test(combinedOutput);

if (testResult.status !== 0) {
  fail(`vitest exited with status ${testResult.status}.`);
}
if (noTestFilesFound) {
  fail("vitest reported \"No test files found\" — vow-gate.integration.test.ts did not run at all.");
}
if (failedMatch && Number(failedMatch[1]) > 0) {
  fail(`${failedMatch[1]} integration test(s) failed.`);
}
if (!passedMatch || Number(passedMatch[1]) === 0) {
  fail(
    "Could not find a 'N passed' count greater than zero in vitest's output. Treating this as " +
      "a failure rather than assuming success — this is the exact silent-pass failure mode " +
      "verify:vow exists to prevent. Re-run with --reporter=verbose output above for detail."
  );
}

console.log(
  `\n[verify:vow] PASSED — migrations applied, synthetic data seeded, role separation confirmed at the ` +
    `database level (roles "${publicRole}" vs "${vowRole}"), and ${passedMatch[1]} integration test(s) ` +
    `confirmed the VOW boundary holds against a real database.\n`
);
