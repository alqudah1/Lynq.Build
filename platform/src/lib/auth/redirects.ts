/**
 * Post-login redirect targets are checked against an allow-list of internal
 * relative paths only (Module 2 §2's open-redirect mitigation, doubly
 * relevant for OAuth since the callback URL itself is a classic
 * open-redirect target if mishandled).
 */
export function isSafeRedirectTarget(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.includes("://");
}

export function resolveSafeRedirectTarget(value: string | null | undefined, fallback = "/"): string {
  return isSafeRedirectTarget(value) ? value : fallback;
}
