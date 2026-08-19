import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // See test/stubs/server-only.ts for why this is aliased. Same pattern
      // as platform/vitest.config.mts.
      "server-only": path.resolve(import.meta.dirname, "test/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Integration tests (*.integration.test.ts) require a real database —
    // see vitest.integration.config.mts. None are runnable yet: no
    // database has been provisioned for byoot/ (deliberately — see
    // byoot/README.md). Excluded from the default fast/offline `npm test`,
    // identical to platform/'s convention.
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
  },
});
