import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Enforces the Neon Auth isolation boundaries from
 * platform/docs/MODULE_2_AUTH_AND_TENANCY_DESIGN.md §19 point 6: no Neon
 * Auth / Better Auth SDK, no reference to NEON_AUTH_BASE_URL or
 * VITE_NEON_AUTH_URL, and no query/mutation against the neon_auth schema —
 * anywhere in application source. Runs in the same `npm test` as
 * everything else, not a separate, skippable step.
 */

const FORBIDDEN_DEPENDENCIES = ["better-auth", "@neondatabase/auth", "@neondatabase/neon-js", "@neondatabase/auth-ui"];
const FORBIDDEN_STRINGS = ["NEON_AUTH_BASE_URL", "VITE_NEON_AUTH_URL", "neon_auth."];

const PLATFORM_ROOT = path.resolve(import.meta.dirname, "../..");
const SRC_ROOT = path.resolve(import.meta.dirname, "..");
// This test file necessarily contains the forbidden strings verbatim (to
// check for them) — exclude only itself, nothing else, from the scan.
const SELF_PATH = path.resolve(import.meta.dirname, "no-neon-auth-usage.test.ts");

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (stat.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("Neon Auth isolation (Module 2 §19 point 6)", () => {
  it("never depends on the Neon Auth / Better Auth SDK", () => {
    const packageJson = JSON.parse(readFileSync(path.join(PLATFORM_ROOT, "package.json"), "utf8"));
    const allDeps = {
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {}),
    };

    for (const forbidden of FORBIDDEN_DEPENDENCIES) {
      expect(Object.keys(allDeps)).not.toContain(forbidden);
    }
  });

  it("never references NEON_AUTH_BASE_URL, VITE_NEON_AUTH_URL, or the neon_auth schema anywhere under src/", () => {
    const offenders: Array<{ file: string; match: string }> = [];

    for (const file of listSourceFiles(SRC_ROOT)) {
      if (file === SELF_PATH) continue;
      const content = readFileSync(file, "utf8");
      for (const forbidden of FORBIDDEN_STRINGS) {
        if (content.includes(forbidden)) {
          offenders.push({ file: path.relative(PLATFORM_ROOT, file), match: forbidden });
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
