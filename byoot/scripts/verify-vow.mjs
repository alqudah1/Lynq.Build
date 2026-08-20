#!/usr/bin/env node
/**
 * npm run verify:vow — the moment-of-truth script.
 *
 * Runs migrations, seeds synthetic data, and executes
 * vow-gate.integration.test.ts against a real database. Exists so proving
 * the VOW boundary actually holds is one command, not a remembered
 * sequence of manual steps someone eventually stops doing.
 *
 * Every step here is designed to fail LOUDLY and NON-ZERO, on purpose:
 *
 * 1. Env vars checked explicitly before anything runs — if
 *    DATABASE_URL / DATABASE_URL_UNPOOLED / DATABASE_URL_VOW_READER are
 *    missing, this exits 1 immediately with a specific message, rather
 *    than letting drizzle-kit or vitest fail later with a more confusing
 *    error (or, worse, not fail at all).
 * 2. Each subprocess's exit code is checked; a non-zero exit from
 *    migration or seeding stops the run immediately — never proceeds to
 *    "run the tests anyway" against a database that isn't in the expected
 *    state.
 * 3. The integration test run's own output is parsed for an explicit
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

const REQUIRED_ENV_VARS = ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "DATABASE_URL_VOW_READER"];

function fail(message) {
  console.error(`\n[verify:vow] FAILED: ${message}\n`);
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

// --- Step 0: refuse to proceed on missing configuration -------------------
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
    "DATABASE_URL_VOW_READER is identical to DATABASE_URL. This defeats the role-separation " +
      "design (see docs/adr/0001-vow-tier-isolation.md) — refusing to run verify:vow against " +
      "a misconfigured pair rather than produce a misleading green result."
  );
}
console.log("[verify:vow] required env vars present and DATABASE_URL_VOW_READER is distinct from DATABASE_URL.");

// --- Step 1: migrations -----------------------------------------------------
step("Running migrations", "npx", ["drizzle-kit", "migrate"]);

// --- Step 2: seed synthetic data --------------------------------------------
step("Seeding synthetic data", "npx", ["tsx", "src/db/seed.ts"]);

// --- Step 3: the actual proof -----------------------------------------------
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
  `\n[verify:vow] PASSED — migrations applied, synthetic data seeded, and ${passedMatch[1]} integration test(s) ` +
    `confirmed the VOW boundary holds against a real database.\n`
);
