/**
 * Conservative normalization used only for duplicate-detection indexes and
 * warnings — never for identity, never a hard uniqueness rule. Over-
 * aggressive automatic merging is explicitly out of scope for this module.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Strips everything but digits and a leading `+` — good enough for exact-match duplicate detection, not a full E.164 parser (no phone-number library dependency introduced for this). */
export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  const hasLeadingPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return hasLeadingPlus ? `+${digits}` : digits;
}

/** Lowercases and strips a leading `www.` and any protocol/path — a coarse signal only, never a uniqueness rule (two records may legitimately share a parent domain). */
export function normalizeDomain(domainOrUrl: string): string {
  let value = domainOrUrl.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/^www\./, "");
  value = value.split("/")[0];
  return value;
}
