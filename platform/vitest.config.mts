import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // See test/stubs/server-only.ts for why this is aliased.
      "server-only": path.resolve(import.meta.dirname, "test/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration tests (*.integration.test.ts) hit the real non-production
    // database and require .env.local sourced first — run separately via
    // `npm run test:integration` (see vitest.integration.config.mts), never
    // as part of the default fast/offline `npm test`.
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
  },
});
