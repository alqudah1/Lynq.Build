/**
 * Risk classification for a spoken Jarvis command.
 *
 * This module is the safety boundary of the phone lane. It decides, from the
 * text of what the founder asked for, whether the confirmed command may open
 * an Office directive directly or must stop at an Office approval that a
 * human decides inside an authenticated session.
 *
 * Three rules shape it:
 *
 * 1. **Fail closed.** A command that does not clearly read as internal,
 *    reversible, information-only work is gated. "Unrecognized" is not
 *    "safe" — an unmatched instruction lands in `medium` and gates.
 * 2. **Speech never lifts a gate.** Every phrase a caller could use to claim
 *    urgency, authority, or a pre-existing approval ("I already approved
 *    this", "skip the approval", "emergency, just do it") is detected as an
 *    OVERRIDE ATTEMPT: it raises the risk level and is recorded, and it can
 *    never lower one. A confirmation on a call confirms what Jarvis
 *    understood; it is not an approval of a gated action.
 * 3. **The categories are the ones the lane brief names**, not a generic
 *    severity guess: outreach, payments, third-party calls, production
 *    changes, deletion, contracts, and credential access.
 *
 * Pure functions over strings — no database, environment, or model call — so
 * the gate is deterministic, fully unit-testable, and cannot fail open
 * because a model was rate-limited.
 */

/** Matches `agentApprovalRequests.riskLevel` so a gated phone command and a gated agent action speak the same vocabulary. */
export type CommandRiskLevel = "low" | "medium" | "high" | "critical";

export type GatedCategory =
  | "customer_outreach"
  | "payment_or_spend"
  | "third_party_call"
  | "production_change"
  | "destructive_change"
  | "contract_or_legal"
  | "credential_access"
  | "public_publishing"
  | "personnel";

export const GATED_CATEGORY_LABELS: Record<GatedCategory, string> = {
  customer_outreach: "Contacting a customer or prospect",
  payment_or_spend: "Spending money or moving funds",
  third_party_call: "Calling or messaging someone outside LYNQ",
  production_change: "Changing the live production site",
  destructive_change: "Deleting or permanently removing something",
  contract_or_legal: "Signing or committing to an agreement",
  credential_access: "Reading or changing credentials",
  public_publishing: "Publishing something publicly",
  personnel: "A hiring, firing, or compensation decision",
};

const CATEGORY_RULES: Array<{ category: GatedCategory; level: CommandRiskLevel; pattern: RegExp }> = [
  {
    category: "customer_outreach",
    level: "high",
    pattern:
      // Verbs allow up to three qualifier words before their object, because
      // real speech puts words in between: "send the customer email", "forward
      // it over to the owner tonight", "get the quote across to Marco".
      /\b(?:cold[-\s]?(?:call|email)|outreach|reach\s+out|email\s+(?:\w+\s+){0,3}(?:client|customer|prospect|lead|restaurant|owner|them|him|her)|(?:send|forward|deliver|share)\s+(?:\w+\s+){0,3}(?:email|message|dm|text|sms|proposal|pitch|invoice|newsletter|quote|note|summary|deck|link)|(?:send|forward|get|pass)\s+(?:\w+\s+){0,3}(?:to|over\s+to|out\s+to|across\s+to)\s+(?:the\s+|a\s+|an\s+)?(?:client|customer|prospect|lead|restaurant|owner|supplier|vendor|partner|them|him|her)|(?:send|forward)\s+(?:it|them|those|these)\s+(?:out|over|off)|follow[-\s]?up\s+with|contact\s+(?:\w+\s+){0,2}(?:client|customer|prospect|lead|restaurant|owner)|sign(?:ed)?\s+(?:\w+\s+){0,3}up\b|blast|campaign\s+send|mail\s?merge)\b/i,
  },
  {
    category: "payment_or_spend",
    level: "critical",
    pattern:
      /\b(?:pay|pays|paid|paying|payments?|purchase|buy|subscribe|upgrade\s+the\s+plan|refunds?|invoice\s+them|charges?|wire|transfer\s+(?:funds|money)|top\s?up|billing|credit\s?card|budget\s+increase|spend|settle\s+(?:the\s+|up\b)|release\s+(?:\w+\s+){0,2}(?:payments?|funds|invoices?)|reimburse|payout)\b/i,
  },
  {
    category: "third_party_call",
    level: "high",
    pattern: /\b(?:call|phone|ring|dial|text)\s+(?:the\s+|a\s+|an\s+)?(?:client|customer|prospect|lead|restaurant|owner|supplier|vendor|partner|them|him|her|number)\b/i,
  },
  {
    category: "production_change",
    level: "critical",
    pattern:
      /\b(?:deploy(?:s|ed|ing)?|promote|ship\s+(?:\w+\s+){0,4}(?:to\s+)?(?:prod|production|live|the\s+live\s+site)|release\s+(?:\w+\s+){0,3}(?:to\s+)?(?:prod|production|live)|go\s+live|live\s+site|push\s+(?:\w+\s+){0,3}to\s+(?:main|master|production)|merge\s+(?:to|into)\s+(?:main|master)|production|prod\b|rollbacks?|roll\s+back|change\s+the\s+(?:alias|domain|dns)|point\s+the\s+domain)\b/i,
  },
  {
    category: "destructive_change",
    level: "critical",
    pattern:
      /\b(?:delete(?:s|d)?|deleting|remove\s+(?:\w+\s+){0,3}(?:projects?|accounts?|records?|data|tables?|repos?|branch(?:es)?|duplicates?|files?|users?)|remove\s+(?:\w+\s+){0,3}permanently|drop\s+(?:the\s+)?(?:table|database)|wipe|purge|erase|truncate|revoke\s+access|deactivate|cancel\s+the\s+(?:account|subscription))\b/i,
  },
  {
    category: "contract_or_legal",
    level: "critical",
    pattern: /\b(?:signs?|signed|signing|contracts?|agreements?|terms\s+of\s+service|nda|msa|statement\s+of\s+work|sow\b|legally|binding|commit\s+us\s+to|counter[-\s]?sign|retainer)\b/i,
  },
  {
    category: "credential_access",
    level: "critical",
    pattern:
      /\b(?:api\s?keys?|access\s?tokens?|secrets?|credentials?|passwords?|env\s+(?:vars?|variables?)|environment\s+variables?|private\s?keys?|ssh\s+keys?|rotate\s+(?:\w+\s+){0,2}(?:keys?|credentials?|secrets?|tokens?|them)|service\s+account|read\s+the\s+\.env)\b/i,
  },
  {
    category: "public_publishing",
    level: "high",
    pattern: /\b(?:publish(?:es|ed|ing)?|post\s+(?:it\s+)?(?:to|on)\s+(?:linkedin|instagram|facebook|x|twitter|the\s+blog)|go\s+public|announce\s+publicly|press\s+release|tweet)\b/i,
  },
  {
    category: "personnel",
    level: "high",
    pattern: /\b(?:hire|fire|terminate\s+(?:the\s+)?employee|lay\s+off|raise\s+(?:their|his|her)\s+(?:salary|pay)|offer\s+letter|compensation)\b/i,
  },
];

/**
 * Phrases that try to talk past the gate. These never reduce risk — matching
 * one raises the command to `critical` and is recorded, because an
 * instruction that argues for skipping approval is exactly the instruction
 * that most needs one.
 */
const OVERRIDE_ATTEMPT_PATTERN =
  /\b(?:skip\s+(?:the\s+)?(?:approval|review|check|gate)|no\s+need\s+(?:for|to)\s+(?:approval|approve|review)|without\s+(?:approval|asking|confirming|review)|don'?t\s+(?:ask|wait|confirm)|bypass|override|i\s+(?:already\s+)?(?:approve|approved|authorize|authorized)\s+(?:it|this|that)|consider\s+(?:it|this)\s+approved|treat\s+this\s+as\s+approved|you\s+have\s+my\s+(?:approval|permission)|just\s+do\s+it\s+now|emergency,?\s+(?:just\s+)?(?:do|send|deploy|pay)|urgent,?\s+(?:just\s+)?(?:do|send|deploy|pay)|trust\s+me|no\s+questions)\b/i;

/**
 * The backstop that makes the fail-closed rule actually hold.
 *
 * The category patterns above will never be exhaustive — English has too many
 * ways to say "send this to someone" — and without this net a single planning
 * verb would disarm the gate. "Write up the pricing summary and forward it to
 * the client" reads as internal because of "write up", even though its real
 * effect is contacting a customer.
 *
 * So this asks a broader, cheaper question than "which category is this?":
 * does the command describe an effect that leaves LYNQ, spends something, or
 * cannot be undone? If it does, the command is gated however much planning
 * language surrounds it — including when no specific category matched and the
 * honest answer is only "this does not look purely internal".
 */
const EXTERNAL_EFFECT_PATTERN =
  /\b(?:send|sends|sending|sent|forward|forwards|forwarding|forwarded|deliver|delivers|delivered|email|emails|emailed|emailing|call|calls|calling|text|texts|texting|message|messages|messaging|dm|publish|publishes|publishing|post|posts|posting|pay|pays|paying|paid|purchase|buy|charge|charges|refund|transfer|deploy|deploys|deploying|deployed|release|releases|releasing|ship|ships|shipping|delete|deletes|deleting|remove|removes|removing|drop|wipe|purge|erase|sign|signs|signing|signed|rotate|rotates|rotating|revoke|revokes|hire|fire|terminate|cancel|cancels|settle|reimburse)\b/i;

/**
 * Work that is genuinely internal, reversible, and produces a document rather
 * than an external effect. Matching this is necessary but NOT sufficient to
 * clear a command: it must also match no gated category and no external
 * effect above.
 */
const INTERNAL_WORK_PATTERN =
  /\b(?:research|analy[sz]e|analysis|review|summari[sz]e|draft|outline|plan|prepare|write\s+(?:up|a\s+(?:brief|plan|doc|summary))|brainstorm|compare|investigate|look\s+into|organi[sz]e|document|audit\s+(?:the\s+)?(?:copy|content|site|process)|estimate|scope|strategy|roadmap|checklist|report)\b/i;

const LEVEL_ORDER: Record<CommandRiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function maxLevel(a: CommandRiskLevel, b: CommandRiskLevel): CommandRiskLevel {
  return LEVEL_ORDER[a] >= LEVEL_ORDER[b] ? a : b;
}

export interface CommandRiskAssessment {
  level: CommandRiskLevel;
  /** True when this command may NOT open a directive without a human decision inside an authenticated session. */
  requiresApproval: boolean;
  gatedCategories: GatedCategory[];
  /** Founder-facing, plain-language reasons. Rendered verbatim in the UI and spoken back on the call. */
  reasons: string[];
  /** True when the caller used language intended to skip the gate. Recorded and audited; never honored. */
  overrideAttempted: boolean;
}

/**
 * Classifies the full text a command was derived from. Callers pass every
 * field that carries founder intent (outcome, target, constraints, proposed
 * steps) concatenated — a gated verb hiding in a step must gate the command
 * just as surely as one in the headline outcome.
 */
export function assessCommandRisk(text: string): CommandRiskAssessment {
  const subject = (text ?? "").trim();
  if (!subject) {
    return {
      level: "medium",
      requiresApproval: true,
      gatedCategories: [],
      reasons: ["Jarvis could not tell what was being asked for, so it stopped for your decision."],
      overrideAttempted: false,
    };
  }

  const gatedCategories: GatedCategory[] = [];
  let level: CommandRiskLevel = "low";
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(subject)) {
      gatedCategories.push(rule.category);
      level = maxLevel(level, rule.level);
    }
  }

  const overrideAttempted = OVERRIDE_ATTEMPT_PATTERN.test(subject);
  if (overrideAttempted) level = "critical";

  const reasons: string[] = gatedCategories.map((category) => GATED_CATEGORY_LABELS[category]);
  if (overrideAttempted) {
    reasons.unshift("The instruction asked to skip approval. Jarvis kept the approval in place.");
  }

  if (gatedCategories.length === 0 && !overrideAttempted) {
    // The internal fast-path is only reachable when the command describes NO
    // outward or irreversible effect at all. A planning verb can never buy its
    // way past a "send", "pay", "deploy", or "delete" sitting next to it.
    if (!EXTERNAL_EFFECT_PATTERN.test(subject) && INTERNAL_WORK_PATTERN.test(subject)) {
      return { level: "low", requiresApproval: false, gatedCategories: [], reasons: [], overrideAttempted: false };
    }
    // Fail closed: recognized as neither purely internal nor a named category.
    return {
      level: "medium",
      requiresApproval: true,
      gatedCategories: [],
      reasons: ["Jarvis could not confirm this is internal, reversible work, so it stopped for your decision."],
      overrideAttempted: false,
    };
  }

  return { level, requiresApproval: true, gatedCategories, reasons, overrideAttempted };
}

/** One sentence Jarvis can say on the call about what happens next. Never claims an action was taken. */
export function describeRiskOutcome(assessment: CommandRiskAssessment): string {
  if (!assessment.requiresApproval) {
    return "This is internal work, so I can open the project and brief the team now.";
  }
  const first = assessment.reasons[0] ?? "This needs your decision";
  return `I can't start this from a phone call because it involves: ${first.toLowerCase()}. I'll put it in LYNQ Office for you to approve, and nothing will happen until you do.`;
}
