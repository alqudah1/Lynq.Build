import { z } from "zod";

/**
 * How much Jarvis is allowed to decide on its own.
 *
 * The Office was built to stop and ask at every gate, which is the right
 * default for something that can spend money or talk to strangers — and
 * the wrong default for a founder who wants the work done while he is at
 * his day job. So autonomy is a stated policy with two separate lanes:
 *
 *  - **build** — researching a prospect, gathering its public evidence,
 *    generating the site, deploying a preview, reviewing it. All of this
 *    happens inside LYNQ and touches nobody outside it, so it runs on its
 *    own unless the founder asks to be consulted.
 *  - **outreach** — actually contacting the business. This reaches a third
 *    party who never asked to hear from LYNQ, so it stays a decision the
 *    founder makes unless he explicitly hands it over.
 *
 * Nothing here removes the audit trail. A decision Jarvis takes alone is
 * recorded with the same binding evidence an approval carries — which
 * restaurant, which evidence version, which commit — so "who decided this
 * and on what" is answerable either way.
 */

export const AUTONOMY_LEVELS = ["auto", "ask"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const autonomyPolicySchema = z.object({
  build: z.enum(AUTONOMY_LEVELS),
  outreach: z.enum(AUTONOMY_LEVELS),
  /** Why the policy is what it is, in the founder's words where he gave them. */
  reason: z.string().trim().min(1).max(400),
});
export type AutonomyPolicy = z.infer<typeof autonomyPolicySchema>;

/**
 * Build and review run unattended; contacting a prospect does not. A
 * founder who wants the emails sent too says so, and that is a deliberate
 * act rather than a default he never chose.
 */
export const DEFAULT_AUTONOMY: AutonomyPolicy = {
  build: "auto",
  outreach: "ask",
  reason: "Jarvis researches, builds and reviews on its own, and asks before contacting a business.",
};

const HAND_OVER_OUTREACH = [
  /\bsend (?:the )?(?:email|emails|outreach|it) (?:yourself|without me|on your own)\b/i,
  /\b(?:don'?t|do not) (?:ask|wait for) me\b/i,
  /\bwithout (?:asking|waiting for) me\b/i,
  /\brun (?:it|the whole thing|everything) end[- ]to[- ]end\b/i,
  /\bhandle (?:it|everything|the whole thing) (?:yourself|for me)\b/i,
  /\bfull(?:y)? autonom(?:y|ous)\b/i,
  /\byou decide\b/i,
  /\breach out (?:to them )?(?:yourself|directly)\b/i,
  /رد بنفسك/,
  /لا\s*تسألني/,
  /بدون\s*ما\s*تسألني/,
];

const KEEP_BUILD_SUPERVISED = [
  /\b(?:ask|check with|confirm with|clear it with) me (?:first|before)\b/i,
  /\bbefore (?:you )?(?:build|start|do) anything\b/i,
  /\blet me (?:approve|review|see)(?: it| this| them)? (?:first|before)\b/i,
  /\bshow me (?:first|before)\b/i,
  /اسألني\s*(?:أولا|أول|قبل)/,
];

/**
 * Read the policy out of what the founder actually said. A directive is
 * the most honest place for this: he states how he wants to work in the
 * same breath as the work, and nothing has to be configured elsewhere.
 */
export function autonomyFromDirective(instruction: string): AutonomyPolicy {
  const text = instruction ?? "";
  const supervised = KEEP_BUILD_SUPERVISED.some((pattern) => pattern.test(text));
  const handsOverOutreach = HAND_OVER_OUTREACH.some((pattern) => pattern.test(text));
  if (supervised) {
    return {
      build: "ask",
      outreach: "ask",
      reason: "You asked to see it before anything is built, so Jarvis stops at every gate.",
    };
  }
  if (handsOverOutreach) {
    return {
      build: "auto",
      outreach: "auto",
      reason: "You told Jarvis to run this end to end, so it builds and sends without stopping, and reports back when it is done.",
    };
  }
  return DEFAULT_AUTONOMY;
}

const AUTONOMY_START = "<!-- LYNQ_OFFICE_AUTONOMY ";
const AUTONOMY_END = " -->";

export function autonomyMarker(policy: AutonomyPolicy): string {
  return `${AUTONOMY_START}${JSON.stringify(policy)}${AUTONOMY_END}`;
}

/** Projects created before this existed fall back to the default rather than failing. */
export function parseAutonomy(content: string | null): AutonomyPolicy {
  if (!content) return DEFAULT_AUTONOMY;
  const start = content.lastIndexOf(AUTONOMY_START);
  if (start < 0) return DEFAULT_AUTONOMY;
  const end = content.indexOf(AUTONOMY_END, start + AUTONOMY_START.length);
  if (end < 0) return DEFAULT_AUTONOMY;
  try {
    return autonomyPolicySchema.parse(JSON.parse(content.slice(start + AUTONOMY_START.length, end)));
  } catch {
    return DEFAULT_AUTONOMY;
  }
}

/* ------------------------------------------------------------------ */
/* Decisions Jarvis took by itself                                     */
/* ------------------------------------------------------------------ */

export const autoDecisionSchema = z.object({
  /** The approval action this decision stands in for. */
  action: z.string().trim().min(1).max(80),
  decidedAt: z.string().trim().min(4).max(40),
  /** Why Jarvis was allowed to decide it. */
  policyReason: z.string().trim().min(1).max(400),
  /** What was decided, for a person reading the project later. */
  summary: z.string().trim().min(1).max(600),
  /** The same binding an approval would have carried. */
  restaurantName: z.string().trim().max(200).nullable().default(null),
  brandPackFingerprint: z.string().trim().max(64).nullable().default(null),
  commitSha: z.string().trim().max(64).nullable().default(null),
});
export type AutoDecision = z.infer<typeof autoDecisionSchema>;

const DECISION_START = "<!-- LYNQ_OFFICE_AUTO_DECISION ";
const DECISION_END = " -->";

export function autoDecisionMarker(decision: AutoDecision): string {
  return `${DECISION_START}${JSON.stringify(decision)}${DECISION_END}`;
}

/**
 * Every decision on the project, not just the most recent — a run can take
 * several, and the gates and the closing report need all of them.
 */
export function parseAutoDecisions(content: string | null): AutoDecision[] {
  if (!content) return [];
  const decisions: AutoDecision[] = [];
  let cursor = 0;
  for (;;) {
    const start = content.indexOf(DECISION_START, cursor);
    if (start < 0) break;
    const end = content.indexOf(DECISION_END, start + DECISION_START.length);
    if (end < 0) break;
    const parsed = autoDecisionSchema.safeParse(safeJson(content.slice(start + DECISION_START.length, end)));
    if (parsed.success) decisions.push(parsed.data);
    cursor = end + DECISION_END.length;
  }
  return decisions;
}

/* ------------------------------------------------------------------ */
/* Work that could not be finished                                     */
/* ------------------------------------------------------------------ */

export const incompleteOutcomeSchema = z.object({
  stage: z.string().trim().min(1).max(40),
  /** What is missing, in words the founder can act on. */
  headline: z.string().trim().min(1).max(200),
  detail: z.string().trim().min(1).max(600),
  recordedAt: z.string().trim().min(4).max(40),
});
export type IncompleteOutcome = z.infer<typeof incompleteOutcomeSchema>;

const INCOMPLETE_START = "<!-- LYNQ_OFFICE_INCOMPLETE ";
const INCOMPLETE_END = " -->";

export function incompleteOutcomeMarker(outcome: IncompleteOutcome): string {
  return `${INCOMPLETE_START}${JSON.stringify(outcome)}${INCOMPLETE_END}`;
}

export function parseIncompleteOutcomes(content: string | null): IncompleteOutcome[] {
  if (!content) return [];
  const outcomes: IncompleteOutcome[] = [];
  let cursor = 0;
  for (;;) {
    const start = content.indexOf(INCOMPLETE_START, cursor);
    if (start < 0) break;
    const end = content.indexOf(INCOMPLETE_END, start + INCOMPLETE_START.length);
    if (end < 0) break;
    const parsed = incompleteOutcomeSchema.safeParse(safeJson(content.slice(start + INCOMPLETE_START.length, end)));
    if (parsed.success) outcomes.push(parsed.data);
    cursor = end + INCOMPLETE_END.length;
  }
  return outcomes;
}

/**
 * Whether a stage failure is worth retrying or worth reporting.
 *
 * An unattended run must not die because a deployment was slow, and must
 * not spin forever because a restaurant publishes no email address. The
 * first is transient and belongs to the retry policy; the second is a fact
 * about the world that no number of retries will change, so the run
 * records it and carries on to the next thing.
 */
const PERMANENT_GAPS = [
  /verified public business email/i,
  /no public email/i,
  /did not pass validation/i,
  /is malformed/i,
  /no approved evidence version/i,
  /already belongs to project/i,
  /identical to the base branch/i,
];

export function isPermanentGap(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return PERMANENT_GAPS.some((pattern) => pattern.test(message));
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
