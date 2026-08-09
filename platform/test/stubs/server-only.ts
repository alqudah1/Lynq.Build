// Test-only stub for the real `server-only` package.
//
// `server-only`'s default export condition throws unconditionally; it only
// resolves to a no-op under the "react-server" export condition, which
// Next.js's own build sets during server compilation but a plain
// Vitest/Node test run does not set by default. This stub is aliased in
// vitest.config.ts (scoped to this one package name only) so modules that
// import "server-only" can be unit tested, without weakening the real,
// build-time guarantee Next.js enforces for actual client bundles.
export {};
