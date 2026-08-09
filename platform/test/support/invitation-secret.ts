/**
 * A single shared, fixed test-only AUTH_SECRET value used by every
 * integration test that exercises the invitation-continuation cookie
 * mechanism. Deliberately the SAME constant across every test file, not a
 * per-file value — `process.env.AUTH_SECRET` is global mutable state, and
 * vitest may interleave multiple test files on shared worker threads; if
 * each file used its own distinct secret and reset it to `undefined` in
 * `afterEach`, a concurrently-running file's in-flight request could read
 * `undefined` (or a different file's secret) mid-test, causing spurious
 * "AUTH_SECRET is not configured" failures. Every file importing this
 * constant, setting it once (and never resetting it to `undefined`),
 * eliminates that race entirely — they all agree on the same value
 * regardless of execution order.
 */
export const TEST_AUTH_SECRET = "test-only-shared-invitation-continuation-secret-".padEnd(32, "x");
