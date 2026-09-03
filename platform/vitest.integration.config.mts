import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Integration tests hit the real non-production Neon database over the
 * HTTP driver. Requires .env.local sourced first (same requirement as
 * `npm run db:migrate` / `npm run db:check`):
 *
 *   set -a && source .env.local && set +a && npm run test:integration
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": path.resolve(import.meta.dirname, "test/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    // Real network round-trips per test; the default 5s unit-test timeout is too tight.
    testTimeout: 20000,
  },
});
