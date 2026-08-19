import path from "node:path";
import { defineConfig } from "vitest/config";

// Mirrors platform/vitest.integration.config.mts. Requires DATABASE_URL and
// DATABASE_URL_VOW_READER to point at a real (non-production — see
// byoot/README.md) Postgres instance with byoot/'s migrations and RLS
// policies applied. Not runnable in this scaffold: no database has been
// provisioned yet. See src/lib/listings/vow-gate.integration.test.ts for
// the test this config exists to run, and byoot/README.md for what
// creating that database involves.
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
    testTimeout: 20_000,
  },
});
