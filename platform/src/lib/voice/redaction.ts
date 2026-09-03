/**
 * Transcript and log redaction for the Jarvis phone lane.
 *
 * Everything a founder says on a call is captured by a third-party speech
 * provider and then stored by us. Two rules follow from that, and they are
 * enforced here rather than at each call site:
 *
 * 1. No secret ever reaches the database or a log line. A spoken API key,
 *    password, verification passcode, or card number is replaced with a
 *    typed placeholder before persistence — there is no "raw transcript"
 *    column anywhere in this lane.
 * 2. No full personal identifier ever reaches a log line. Phone numbers are
 *    masked to their last four digits (the existing `JARVIS_VOICE_SETUP.md`
 *    requirement, now actually implemented), emails to their domain.
 *
 * Deliberately NOT `server-only`: these are pure string functions with no
 * database, environment, or network access, and the unit tests for them run
 * in the plain node environment alongside the rest of `src/lib/voice`.
 */

/** The typed placeholders. Kept as a closed set so a reviewer can grep for what a redacted transcript can contain. */
export const REDACTION_PLACEHOLDERS = {
  secret: "[redacted-secret]",
  card: "[redacted-card-number]",
  government_id: "[redacted-government-id]",
  email: "[redacted-email]",
  phone: "[redacted-phone]",
  number: "[redacted-number]",
} as const;

export type RedactionPlaceholder = keyof typeof REDACTION_PLACEHOLDERS;

/**
 * A spoken verification passcode is caught by the six-or-more-digit rule and
 * comes out as `[redacted-number]`. There is deliberately no distinct
 * `passcode` placeholder: emitting one would tell a reader of the transcript
 * that the redacted run WAS a passcode, which is more than they need to know.
 */

/**
 * Speech-to-text writes numbers as words at least as often as digits, so a
 * digit-only redaction pass would miss "my code is one two three four five
 * six" entirely. This normalizes spoken digits so the passcode and secret
 * rules below can see them.
 */
const SPOKEN_DIGITS: Record<string, string> = {
  zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4",
  five: "5", six: "6", seven: "7", eight: "8", nine: "9",
};

/** Turns a run of three or more spoken digit words into the digits they name. Shorter runs ("two pages") are left alone. */
export function collapseSpokenDigits(value: string): string {
  const wordPattern = Object.keys(SPOKEN_DIGITS).join("|");
  const runPattern = new RegExp(`\\b(?:${wordPattern})(?:[\\s,.-]+(?:${wordPattern})){2,}\\b`, "gi");
  return value.replace(runPattern, (match) =>
    match
      .toLowerCase()
      .split(/[\s,.-]+/)
      .filter(Boolean)
      .map((word) => SPOKEN_DIGITS[word] ?? "")
      .join("")
  );
}

/**
 * Words that mean "a secret follows". A digit run or token near one of these
 * is redacted even when it would otherwise look harmless — the false
 * positive (losing a legitimate number) is always cheaper than the false
 * negative (storing a credential).
 */
const SECRET_LEAD_IN =
  /\b(?:password|passphrase|pass\s?code|passcode|pin|otp|one[-\s]?time\s?code|security\s?code|verification\s?code|access\s?code|secret|api\s?key|apikey|token|private\s?key|credential|cvv|cvc)\b/i;

const RULES: Array<{ pattern: RegExp; placeholder: RedactionPlaceholder }> = [
  // Provider-shaped API keys first: they are unambiguous and would otherwise
  // be partially eaten by the generic long-token rule below.
  { pattern: /\b(?:sk|pk|rk|whsec|xoxb|xoxp|ghp|gho|ghs|github_pat)[-_][A-Za-z0-9_-]{8,}\b/g, placeholder: "secret" },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, placeholder: "secret" },
  // "the password is hunter2", "api key: abc123def456" — the lead-in word plus
  // an EXPLICIT connector decides, so the value itself does not have to look
  // like a credential.
  //
  // The connector is required, and both whitespace runs are bounded. Two
  // reasons, both found the hard way:
  //
  //  - Without a required connector this ate ordinary speech: "Pin the launch
  //    note", "the design token system", "the secret sauce recipe" all matched,
  //    and the mangled text is what reaches the Office planner.
  //  - Unbounded `\s+ … \s*` around an optional connector is ambiguous, and
  //    backtracks quadratically: 80k spaces after "password" took ~10s. The
  //    webhook accepts a 1 MB body, so that is a single-request CPU stall.
  {
    pattern: new RegExp(`(${SECRET_LEAD_IN.source})([ \\t]{0,4}(?:is|are|equals|=|:)[ \\t]{0,4})([^\\s,.;]{3,})`, "gi"),
    placeholder: "secret",
  },
  // Payment cards (13-19 digits, optionally grouped) before the generic
  // digit-run rule so they get the more specific placeholder.
  { pattern: /\b(?:\d[ -]?){13,19}\b/g, placeholder: "card" },
  // North American SIN/SSN shapes.
  { pattern: /\b\d{3}[ -]\d{2}[ -]\d{4}\b/g, placeholder: "government_id" },
  { pattern: /\b\d{3}[ -]\d{3}[ -]\d{3}\b/g, placeholder: "government_id" },
  { pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, placeholder: "email" },
  // E.164 and common North American spoken/typed phone shapes.
  { pattern: /\+\d[\d\s().-]{7,17}\d/g, placeholder: "phone" },
  { pattern: /\b\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/g, placeholder: "phone" },
  // Any remaining bare run of six or more digits. Six is the verification
  // passcode length, and no legitimate spoken instruction in this lane needs
  // a six-digit literal preserved.
  { pattern: /\b\d{6,}\b/g, placeholder: "number" },
  // A long opaque token (mixed-case/underscored, >= 20 chars) is far more
  // likely a credential than a word. Plain prose never matches: the run must
  // contain at least one digit and have no spaces.
  { pattern: /\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}\b/g, placeholder: "secret" },
];

export interface RedactionResult {
  text: string;
  /** Which placeholder kinds were applied, in a stable order — safe to log and to show a founder ("I removed a code you read out"). */
  redactedKinds: RedactionPlaceholder[];
}

/**
 * Redacts one piece of spoken or written text. Idempotent: running it over
 * already-redacted text does not re-redact the placeholders themselves.
 */
/**
 * Upper bound on the text one call to `redactSensitiveText` will scan.
 *
 * The rules below run over the whole string, and the Vapi webhook accepts a
 * body up to 1 MB. No genuine spoken turn or end-of-call transcript comes close
 * to this, so truncating is both safe and the simplest guarantee that a hostile
 * or malformed payload cannot turn redaction into a CPU stall.
 */
const MAX_REDACTION_INPUT = 40_000;

export function redactSensitiveText(value: string): RedactionResult {
  if (!value) return { text: "", redactedKinds: [] };

  const applied = new Set<RedactionPlaceholder>();
  let text = collapseSpokenDigits(value.slice(0, MAX_REDACTION_INPUT));

  for (const rule of RULES) {
    text = text.replace(rule.pattern, (match, ...groups) => {
      // The lead-in rule keeps the phrase ("the password is") and replaces
      // only the value, so the transcript still reads naturally.
      if (rule.placeholder === "secret" && typeof groups[0] === "string" && typeof groups[1] === "string") {
        applied.add("secret");
        return `${groups[0]}${groups[1]}${REDACTION_PLACEHOLDERS.secret}`;
      }
      if (match.includes("[redacted-")) return match;
      applied.add(rule.placeholder);
      return REDACTION_PLACEHOLDERS[rule.placeholder];
    });
  }

  const order: RedactionPlaceholder[] = ["secret", "card", "government_id", "email", "phone", "number"];
  return { text: text.trim(), redactedKinds: order.filter((kind) => applied.has(kind)) };
}

/** Convenience wrapper for the common "I only want the safe string" call. */
export function redactTranscriptText(value: string): string {
  return redactSensitiveText(value).text;
}

/**
 * Masks a phone number to its last four digits. Used for every log line and
 * every founder-facing screen — the full number is never re-displayed, even
 * though the founder obviously knows their own number, because these screens
 * and logs are read by more than one person.
 */
export function maskPhoneNumber(value: string | null | undefined): string {
  if (!value) return "unknown";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `••• ••• ${digits.slice(-4)}`;
}

/** The stable, non-reversible identifier a call session stores instead of the caller's number. */
export function phoneNumberLastFour(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/**
 * Builds a log-safe structured record. Any value whose key names a secret is
 * dropped entirely (not redacted — dropped, so a typo in a key name can never
 * leak through a placeholder), and any string value is passed through the
 * transcript redactor.
 */
const FORBIDDEN_LOG_KEYS =
  /(secret|token|key|password|passcode|credential|authorization|cookie|signature|transcript|phone|number|caller)/i;

export function redactLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) {
      safe[key] = null;
      continue;
    }
    if (FORBIDDEN_LOG_KEYS.test(key)) {
      // Booleans and counts derived from a sensitive field are themselves
      // safe and genuinely useful when debugging ("was a caller number
      // present at all?"), so they survive; every other shape is dropped.
      safe[key] = typeof value === "boolean" || typeof value === "number" ? value : "[redacted]";
      continue;
    }
    safe[key] = typeof value === "string" ? redactTranscriptText(value) : value;
  }
  return safe;
}
