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
/**
 * The canonical spoken-digit vocabulary for the whole phone lane, including
 * the homophones a transcriber produces ("o" for zero, "for" for four).
 *
 * This lives here, and `founder-verification.ts` imports the scanner below
 * rather than keeping its own copy, because the two used to disagree — and the
 * disagreement was a credential leak. Verification concatenated digits across
 * ANY separator (it exists precisely because transcribers split codes), while
 * redaction only merged runs of three or more consecutive digit WORDS and
 * otherwise needed one unbroken numeric token. So the most natural utterance
 * of all, "the code is 417 296", verified as 417296 and was stored verbatim in
 * the transcript — where any member of the organization could read it, next to
 * the last four digits of the founder's number, for the fifteen minutes the
 * code stays valid.
 *
 * One vocabulary and one scanner is the only structural guarantee that what
 * verification accepts, redaction removes.
 */
/**
 * What a digit can be SPELLED as, for detection. Deliberately wide: it carries
 * the homophones a transcriber produces, because over-detecting a number in a
 * transcript costs a `[redacted-number]` where a figure used to be, and
 * under-detecting one leaves a live credential in the database.
 */
const SPOKEN_DIGITS_WIDE: Record<string, string> = {
  zero: "0", oh: "0", o: "0", one: "1", two: "2", to: "2", too: "2", three: "3",
  four: "4", for: "4", five: "5", six: "6", seven: "7", eight: "8", ate: "8", nine: "9",
};

/**
 * What a digit can be spelled as when READING A CODE BACK for comparison.
 * Narrow on purpose, and a strict subset of the wide list.
 *
 * The wide list's homophones are wrong here: they are ordinary English words
 * that sit next to a code in ordinary speech, and each one silently extends
 * the run. "the code is 014149 too" normalized to a seven-digit `0141492` and
 * was rejected as unreadable — burning one of three attempts and telling the
 * founder "I need all six digits" when they had read exactly six. Same for
 * "014149 for the call", "014149 to verify", and "it's for 014149".
 *
 * The subset relationship is what preserves the safety guarantee: any run
 * verification will accept is also found by the wide scanner, so anything that
 * can authenticate is still redacted.
 */
const SPOKEN_DIGITS_NARROW: Record<string, string> = {
  // `o` stays: as a standalone token it is a spoken zero, never an English
  // word. `to`, `too`, `for` and `ate` are the ones that had to go — those are
  // ordinary words that sit next to a code and silently extend it.
  zero: "0", oh: "0", o: "0", one: "1", two: "2", three: "3",
  four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
};

const SPOKEN_DIGITS = SPOKEN_DIGITS_WIDE;

/**
 * Words a speaker drops into the middle of a code without breaking it
 * ("four one seven, um, two nine six"). Allowed between digit tokens so the
 * run survives, bounded so a run cannot wander across a whole sentence.
 */
const RUN_FILLERS = new Set(["um", "uh", "er", "ah", "like", "then", "and", "ok", "okay", "so", "sorry", "again", "is", "its", "it", "my", "the", "code", "that"]);

/**
 * The fillers a caller actually says INSIDE a code, as they read it out:
 * "417, um, 296", "417 then 296". A filler can only bridge two genuine digit
 * groups, never introduce a digit of its own, so this list is safe to keep
 * short but useful.
 *
 * `and` is deliberately NOT here. It is a filler in the wide list, where
 * over-detection is the safe direction, but it bridged "014149 and to be
 * clear" into a seven-digit run and made a correct code unreadable.
 */
const RUN_FILLERS_NARROW = new Set(["um", "uh", "er", "ah", "sorry", "then"]);

export interface DigitRunOptions {
  /**
   * `wide` (default) detects as much as possible, for redaction. `narrow`
   * reads a code back for comparison and must not absorb ordinary words next
   * to it. Narrow is a strict subset of wide, so anything narrow accepts is
   * still redacted.
   */
  vocabulary?: "wide" | "narrow";
}

const MAX_FILLERS_PER_RUN = 2;

export interface SpokenDigitRun {
  /** Index of the first character of the run in the input string. */
  start: number;
  /** Index one past the last character of the run. */
  end: number;
  /** The digits the run names, in order. */
  digits: string;
}

/**
 * Finds every span that reads as a sequence of digits, whether spoken as
 * words, written as numerals, or mixed, tolerating a little filler in the
 * middle.
 *
 * Returns spans rather than a rewritten string. An earlier version rewrote the
 * text in place — collapsing any three adjacent number words into digits — so
 * "we lost one, oh, two clients last month" was stored as "we lost 102
 * clients", and that mangled text is what reached the risk classifier and the
 * Office planner. Detection and rewriting are different jobs.
 */
export function findSpokenDigitRuns(value: string, options: DigitRunOptions = {}): SpokenDigitRun[] {
  const narrow = options.vocabulary === "narrow";
  const words = narrow ? SPOKEN_DIGITS_NARROW : SPOKEN_DIGITS_WIDE;
  const fillers = narrow ? RUN_FILLERS_NARROW : RUN_FILLERS;

  const tokens: Array<{ text: string; start: number; end: number }> = [];
  for (const match of value.matchAll(/[A-Za-z]+|\d+/g)) {
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }

  const digitsOf = (token: string): string | null => {
    if (/^\d+$/.test(token)) return token;
    return words[token.toLowerCase()] ?? null;
  };

  const runs: SpokenDigitRun[] = [];
  let index = 0;
  while (index < tokens.length) {
    const first = digitsOf(tokens[index].text);
    if (first === null) {
      index += 1;
      continue;
    }

    let digits = first;
    let last = index;
    let cursor = index + 1;
    let fillersUsed = 0;
    while (cursor < tokens.length) {
      const value = digitsOf(tokens[cursor].text);
      if (value !== null) {
        digits += value;
        last = cursor;
        cursor += 1;
        continue;
      }
      // A filler only extends the run if a digit actually follows it.
      const isFiller = fillers.has(tokens[cursor].text.toLowerCase());
      if (isFiller && fillersUsed < MAX_FILLERS_PER_RUN && cursor + 1 < tokens.length && digitsOf(tokens[cursor + 1].text) !== null) {
        fillersUsed += 1;
        cursor += 1;
        continue;
      }
      break;
    }

    runs.push({ start: tokens[index].start, end: tokens[last].end, digits });
    index = last + 1;
  }
  return runs;
}

/**
 * Turns a run of three or more spoken digit words into the digits they name.
 * Retained as a standalone helper for callers that genuinely want the numeric
 * form; deliberately NOT part of the redaction pipeline, which now redacts
 * spans in place instead of rewriting the transcript.
 */
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
 * Digits at or above this length are redacted wherever they appear. Six is the
 * verification passcode length, and no legitimate spoken instruction in this
 * lane needs a six-digit literal preserved.
 */
export const MIN_REDACTED_DIGIT_RUN = 6;

/** Replaces every digit run of at least `MIN_REDACTED_DIGIT_RUN` digits, right to left so earlier offsets stay valid. */
function redactDigitRuns(text: string): { text: string; redacted: boolean } {
  const runs = findSpokenDigitRuns(text).filter((run) => run.digits.length >= MIN_REDACTED_DIGIT_RUN);
  if (runs.length === 0) return { text, redacted: false };
  let output = text;
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    output = `${output.slice(0, run.start)}${REDACTION_PLACEHOLDERS.number}${output.slice(run.end)}`;
  }
  return { text: output, redacted: true };
}

/**
 * Words that mean "a secret follows". A digit run or token near one of these
 * is redacted even when it would otherwise look harmless — the false
 * positive (losing a legitimate number) is always cheaper than the false
 * negative (storing a credential).
 */
const SECRET_LEAD_IN =
  /\b(?:password|passphrase|pass\s?code|passcode|pin|otp|one[-\s]?time\s?code|security\s?code|verification\s?code|access\s?code|secret|api\s?key|apikey|token|private\s?key|(?<!low[- ])(?<!high[- ])key\b(?!\s*(?:metrics?|findings?|takeaways?|points?|results?|players?|dates?|risks?|drivers?|accounts?|words?|word|performance|indicators?|stakeholders?|themes?|questions?|numbers?))|credential|cvv|cvc|(?<!source\s)(?<!zip\s)(?<!postal\s)(?<!post\s)(?<!area\s)code(?!\s*(?:base|review|freeze|quality|coverage|style|snippet)))\b/i;

/**
 * Up to four words may sit between the lead-in noun and the connector. Real
 * speech puts them there constantly — "the password FOR THE ADMIN ACCOUNT is
 * swordfish99", "the access code YOU NEED is hunter2please" — and the previous
 * rule bound the connector directly to the noun with `[ \t]{0,4}`, so every one
 * of those leaked the credential verbatim into the transcript and the logs.
 *
 * Bounded on both axes (at most 4 words, each at most 20 characters) so the
 * nested quantifier cannot backtrack expensively.
 */
const LEAD_IN_GAP = "(?:[ \\t]{1,4}[A-Za-z'’]{1,20}\\b){0,4}";
/** Connectors that assert "what follows IS the value". A value after one of these is redacted whatever it looks like. */
const STRONG_CONNECTOR = "(?:is|are|equals|reads|=|:|'s|’s)";
/** Weaker separators. A value after one of these is redacted only when it also looks like a credential. */
const WEAK_CONNECTOR = "(?:[,\\-—]|\\n)";
/** "looks like a credential": at least six non-breaking characters, at least one of them a digit. */
const SECRET_SHAPED_VALUE = "(?=[^\\s,.;]{6,})(?=[^\\s,.;]{0,64}\\d)[^\\s,.;]+";

/**
 * `whole` replaces the entire match; `value-last` keeps groups 1-2 (the
 * lead-in phrase and its connector) and replaces group 3, so the transcript
 * still reads naturally; `value-first` replaces group 1 and keeps the rest.
 */
type RuleShape = "whole" | "value-last" | "value-first";

/**
 * Provider-shaped keys and the lead-in rules. Run AFTER the digit-run scan, so
 * "the code is 417 296" loses the whole code rather than only its first group.
 */
const SECRET_RULES: Array<{ pattern: RegExp; placeholder: RedactionPlaceholder; shape?: RuleShape }> = [
  // Provider-shaped API keys first: they are unambiguous and would otherwise
  // be partially eaten by the generic long-token rule below.
  { pattern: /\b(?:sk|pk|rk|whsec|xoxb|xoxp|ghp|gho|ghs|github_pat)[-_][A-Za-z0-9_-]{8,}\b/g, placeholder: "secret" },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, placeholder: "secret" },
  // "the password is hunter2", "api key: abc123def456" — a lead-in word plus an
  // EXPLICIT connector decides, so the value itself does not have to look like
  // a credential.
  //
  // The connector is required, and every whitespace run is bounded. Two
  // reasons, both found the hard way:
  //
  //  - Without a required connector this ate ordinary speech: "Pin the launch
  //    note", "the design token system", "the secret sauce recipe" all matched,
  //    and the mangled text is what reaches the Office planner.
  //  - Unbounded `\s+ … \s*` around an optional connector is ambiguous, and
  //    backtracks quadratically: 80k spaces after "password" took ~10s. The
  //    webhook accepts a 1 MB body, so that is a single-request CPU stall.
  //
  // A key read out one character at a time: "the key is A B C D E F G H".
  // Checked before the general rule below, whose value group needs three
  // unbroken characters and so never sees a spelled-out value at all.
  {
    shape: "value-last",
    pattern: new RegExp(`(${SECRET_LEAD_IN.source})(${LEAD_IN_GAP}[ \\t]{0,4}${STRONG_CONNECTOR}[ \\t]{0,4})((?:[A-Za-z0-9][ \\t.-]{1,3}){5,40}[A-Za-z0-9])`, "gi"),
    placeholder: "secret",
  },
  {
    shape: "value-last",
    pattern: new RegExp(`(${SECRET_LEAD_IN.source})(${LEAD_IN_GAP}[ \\t]{0,4}${STRONG_CONNECTOR}[ \\t\\n\\r]{0,4})([^\\s,.;]{3,})`, "gi"),
    placeholder: "secret",
  },
  // "the password, swordfish99" / "the api key - zx9k2m4p8q". A weak separator
  // is not evidence on its own, so the value must also look like a credential
  // — otherwise "the password, which we rotate monthly" would lose a word.
  {
    shape: "value-last",
    pattern: new RegExp(`(${SECRET_LEAD_IN.source})(${LEAD_IN_GAP}[ \\t]{0,4}${WEAK_CONNECTOR}[ \\t\\n\\r]{0,4})(${SECRET_SHAPED_VALUE})`, "gi"),
    placeholder: "secret",
  },
  // Value first: "use swordfish99 as the password".
  {
    pattern: new RegExp(`(${SECRET_SHAPED_VALUE})([ \\t]{1,4}(?:as|is|for)[ \\t]{1,4}(?:the|my|our|your|his|her|their)?[ \\t]{0,4})(${SECRET_LEAD_IN.source})`, "gi"),
    placeholder: "secret",
    shape: "value-first",
  },
];

/**
 * Rules that must run BEFORE the digit-run scan, so a card, government ID or
 * phone number keeps its own placeholder instead of being swallowed as a
 * generic run of digits.
 */
const PRE_RUN_RULES: Array<{ pattern: RegExp; placeholder: RedactionPlaceholder; shape?: RuleShape }> = [
  // Payment cards (13-19 digits, optionally grouped).
  { pattern: /\b(?:\d[ -]?){13,19}\b/g, placeholder: "card" },
  // North American SIN/SSN shapes.
  { pattern: /\b\d{3}[ -]\d{2}[ -]\d{4}\b/g, placeholder: "government_id" },
  { pattern: /\b\d{3}[ -]\d{3}[ -]\d{3}\b/g, placeholder: "government_id" },
  // Every quantifier is bounded. `[A-Za-z0-9._%+-]+@…` is quadratic on any long
  // run of class characters with no `@`: the `+` consumes to the end, fails,
  // backtracks and restarts one position later. At the 40k input cap that was
  // ~1.9s of blocked event loop per webhook, reachable with a plain digit run
  // or a dotted string — both things a real end-of-call summary can contain.
  { pattern: /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,4}\b/g, placeholder: "email" },
  // E.164 and common North American spoken/typed phone shapes.
  { pattern: /\+\d[\d\s().-]{7,17}\d/g, placeholder: "phone" },
  { pattern: /\b\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/g, placeholder: "phone" },
];

/** Rules that run after the digit-run scan. */
const POST_RUN_RULES: Array<{ pattern: RegExp; placeholder: RedactionPlaceholder; shape?: RuleShape }> = [
  // A long opaque token (mixed-case/underscored, >= 20 chars) is far more
  // likely a credential than a word. Plain prose never matches: the run must
  // contain at least one digit and have no spaces.
  { pattern: /\b(?=[A-Za-z0-9_-]{0,199}\d)[A-Za-z0-9_-]{20,200}\b/g, placeholder: "secret" },
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

/** A match that is nothing but placeholders has already been redacted; anything else may still hide a value. */
const ONLY_PLACEHOLDERS = /^(?:\[redacted-[a-z-]+\])+$/;

/**
 * No genuine spoken word is this long. Collapsing any unbroken run that is,
 * before the rules see it, is both the honest classification (an opaque
 * 200-character blob in a phone transcript is a credential or garbage) and
 * what keeps the rules linear.
 */
const MAX_TOKEN_LENGTH = 200;
const LONG_TOKEN = /\S{200,}/g;

export function redactSensitiveText(value: string): RedactionResult {
  if (!value) return { text: "", redactedKinds: [] };

  const applied = new Set<RedactionPlaceholder>();
  let text = value.slice(0, MAX_REDACTION_INPUT);

  // Several rules are quadratic on a single enormous token — the email rule
  // alone cost ~1.9s at the input cap on a plain run of digits — and the
  // webhook accepts a 1 MB body. Capping first keeps them linear.
  const capLongTokens = () => {
    const capped = text.replace(LONG_TOKEN, REDACTION_PLACEHOLDERS.secret);
    if (capped !== text) {
      applied.add("secret");
      text = capped;
    }
  };
  capLongTokens();
  void MAX_TOKEN_LENGTH;

  const runRules = (rules: typeof SECRET_RULES) => {
  for (const rule of rules) {
    text = text.replace(rule.pattern, (match, ...groups) => {
      // Skip only a match that IS already a placeholder. `includes` was too
      // broad: with the digit-run scan running first, "the password is
      // 123456hunter2" became "…is [redacted-number]hunter2", and the lead-in
      // rule that would have taken the WHOLE value then refused to fire
      // because its match contained a placeholder — leaving the tail of the
      // credential in the transcript.
      if (ONLY_PLACEHOLDERS.test(match)) return match;
      const placeholder = REDACTION_PLACEHOLDERS[rule.placeholder];
      // The lead-in rules keep the phrase ("the password is") and replace only
      // the value, so the transcript still reads naturally.
      if (rule.shape === "value-last" && typeof groups[0] === "string" && typeof groups[1] === "string") {
        applied.add(rule.placeholder);
        return `${groups[0]}${groups[1]}${placeholder}`;
      }
      if (rule.shape === "value-first" && typeof groups[1] === "string" && typeof groups[2] === "string") {
        applied.add(rule.placeholder);
        return `${placeholder}${groups[1]}${groups[2]}`;
      }
      applied.add(rule.placeholder);
      return placeholder;
    });
  }
  };

  // Cards, government IDs, emails and phone numbers first, so each keeps its
  // own placeholder rather than being swallowed as a generic run of digits.
  runRules(PRE_RUN_RULES);
  // Re-cap. The card, government-ID and phone rules consume their own trailing
  // separator, so a run of adjacent matches is replaced by adjacent
  // placeholders with NO whitespace between them — one enormous token that the
  // first cap never saw. `"1111111111111 "` repeated to the input cap turned
  // 39 KB of digits and spaces into a 61 KB unbroken token and cost 4 seconds
  // in the value-first secret rule below.
  capLongTokens();
  const runs = redactDigitRuns(text);
  text = runs.text;
  if (runs.redacted) applied.add("number");
  runRules(SECRET_RULES);
  runRules(POST_RUN_RULES);

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
