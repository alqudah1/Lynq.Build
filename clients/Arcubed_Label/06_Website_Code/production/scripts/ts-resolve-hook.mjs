// Verification-only Node ESM resolve hook. NOT part of the app, not
// imported by anything else — exists solely so scripts/test-*.ts can run
// the app's real .ts source files directly via plain `node`, which requires
// explicit extensions on relative imports (the app itself relies on
// Next.js's bundler for extensionless resolution, which is correct and
// unrelated to this test-running limitation).
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
    for (const ext of [".ts", ".tsx", ".js"]) {
      try {
        return await nextResolve(specifier + ext, context);
      } catch {
        // try the next extension
      }
    }
  }
  return nextResolve(specifier, context);
}
