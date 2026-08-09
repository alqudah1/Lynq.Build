import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Component-level accessibility tests (Step 5A) — a jsdom environment,
 * kept entirely separate from the fast/offline `vitest.config.mts` (node
 * environment, no DOM) so the default `npm test` stays fast and unaffected.
 * Run via `npm run test:a11y`.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": path.resolve(import.meta.dirname, "test/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.a11y.test.tsx"],
    setupFiles: ["./test/setup/a11y.ts"],
  },
});
