// Test-only stub for the real `server-only` package. Copied verbatim from
// platform/test/stubs/server-only.ts — see that file's comment for why this
// is needed (the real package throws unconditionally outside Next.js's own
// "react-server" build condition, which a plain Vitest/Node run doesn't set).
export {};
