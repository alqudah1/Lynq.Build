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
 *
 * ## Why clearance is decided per clause
 *
 * The first version of this file asked its questions of the WHOLE string:
 * does any category match, does any effect word appear, does any internal
 * verb appear. That last question is the one that broke it. "Does any
 * internal verb appear" is satisfied by a single word, so an instruction
 * only had to *begin* like internal work to clear:
 *
 *     "Draft the plan and clear the production database tonight"  →  low
 *     "Draft the plan and read me the stripe restricted key"      →  low
 *     "Draft the plan and order fifty tablets"                    →  low
 *
 * Each of those really did clear, because the smuggled clause contains no
 * word from the effect list — and the effect list can never be complete.
 * The planning verb was not incidental; it was the disarm mechanism, and it
 * is the single most natural way a founder opens a sentence.
 *
 * So clearance is now asked of every clause, not of the string. The text is
 * split at coordination and sentence boundaries, each segment that has the
 * shape of a command (a verb followed by an object) must ITSELF read as
 * internal work, and a segment that does not is named back to the founder.
 * This inverts the failure direction: a clause whose verb nobody thought of
 * now gates, because it fails to be recognized as internal rather than
 * failing to be recognized as dangerous. Vocabulary gaps become approval
 * clicks instead of silent external actions.
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

/**
 * Words that follow a verb and mark what it acts on. Used to tell a COMMAND
 * ("clear the production database") from a sentence fragment or a list
 * continuation ("Gojiberry for outreach tooling", "Acme Foods"), which is the
 * distinction the clause rule below rests on.
 *
 * Determiners and object pronouns in several languages, because a transcript
 * carries whatever the founder actually said, and number words because a
 * quantity is the most common object of a purchase.
 */
const OBJECT_TOKENS =
  "the|a|an|it|its|this|that|these|those|them|him|her|us|me|my|our|your|their|his|all|any|every|both|some|more|another|few|several|couple|" +
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|" +
  "le|la|les|el|los|las|un|una|uno|die|der|das|ein|eine";

/** Particles that sit between a phrasal verb and its object: "clear OUT the records", "take DOWN the site". */
const VERB_PARTICLES = "up|out|off|over|back|down|together|in|on|around";

/**
 * A segment reads as a command when it opens with a verb, an optional
 * particle, and an object token. Deliberately shape-based rather than
 * lexical: it does not need to know that "clear" or "envoyer" are verbs, only
 * that something is being done to something.
 */
const PREDICATE_SHAPE = new RegExp(`^[^A-Za-z0-9]*[\\p{L}'-]+(?:\\s+(?:${VERB_PARTICLES}))?\\s+(?:${OBJECT_TOKENS}|\\d+)\\b`, "iu");

/**
 * Boundaries that start a new clause. Sentence terminators always split.
 * Commas and coordinators split ONLY when what follows has the shape of a
 * command — otherwise "Compare Instantly and Gojiberry for outreach tooling"
 * would be torn into fragments and each fragment would gate for failing to
 * look like internal work. Splitting conservatively keeps the false-positive
 * cost down; splitting at all is what closes the smuggling hole.
 */
const COORDINATOR = new RegExp(
  `(?:[.;!?\\n]+|,\\s+|\\s+(?:and\\s+then|and|then|also|plus|next|after\\s+that|followed\\s+by)\\s+)` +
    `(?=[^A-Za-z0-9]*[\\p{L}'-]+(?:\\s+(?:${VERB_PARTICLES}))?\\s+(?:${OBJECT_TOKENS}|\\d+)\\b)`,
  "iu"
);

/**
 * Spans that name a TOPIC rather than an action, rewritten to a neutral token
 * before any rule runs. Every one of these was a real false positive: the
 * founder asking Jarvis to *write about* something risky was told the work
 * itself was risky, with a reason line that reads as a bug ("Review our
 * password policy document" → "Reading or changing credentials", critical).
 *
 * Over-gating is not a safe default. Each false positive is friction on
 * ordinary work and trains the founder to approve without reading, which is
 * the failure mode that makes every real gate below worthless.
 *
 * Each pattern keeps its leading verb (`$1`) so the segment still reads as
 * internal work; only the risky-sounding object is neutralized. Masks are
 * applied PER SEGMENT, so a mask can never reach across a clause boundary and
 * swallow a real action that follows.
 */
const TOPIC_MASKS: Array<{ pattern: RegExp; replacement: string }> = [
  // "the wipe procedure", "the deploy process", "our password policy", "the offer letter template"
  {
    pattern:
      /\b(wipe|deletion|delete|deploy(?:ment)?|rollback|release|hiring|firing|offer(?:\s+letter)?|contract|nda|password|credential|payment|refund|access|onboarding|offboarding|outreach|escalation|security|incident|approval|expense|purchase|termination)\s+(polic(?:y|ies)|procedures?|process(?:es)?|guides?|playbooks?|runbooks?|documentation|checklists?|templates?|flows?|standards?)\b/gi,
    replacement: "$2 about internal topics",
  },
  // "a policy for how we revoke access when someone leaves"
  {
    pattern: /\b(polic(?:y|ies)|procedures?|process(?:es)?|guides?|playbooks?|runbooks?|documentation|standards?)\s+(?:for|about|on|covering)\s+(?:how\s+)?[^.;,]{0,60}/gi,
    replacement: "$1 about internal topics",
  },
  // "Research what an NDA usually covers", "Research how much a campaign send costs"
  {
    pattern: /\b(research(?:es|ed|ing)?|investigate|explain|document|find\s+out|look\s+into|learn)\s+(?:what|how|whether|why|when|if)\b[^.;,]{0,70}/gi,
    replacement: "$1 an internal topic",
  },
  // "Analyze how much we spend on tooling each month"
  { pattern: /\bhow\s+(?:much|many|often)\s+(?:we|they|it|our|their)\b[^.;,]{0,60}/gi, replacement: "an internal topic" },
  // "Draft an internal doc about how we handle api keys" — describing practice, not doing it
  {
    pattern: /\b(about|on|covering|explaining|describing|regarding)\s+how\s+(?:we|they|our\s+team|the\s+team)\b[^.;,]{0,60}/gi,
    replacement: "$1 an internal topic",
  },
  // "a plan to hire more efficiently" — an adverb, not an instance of hiring
  {
    pattern: /\b(hire|fire|deploy|publish|pay|spend|onboard)\s+(?:more|less)?\s*(?:efficiently|effectively|better|faster|smarter|quicker|carefully|consistently)\b/gi,
    replacement: "improve an internal practice",
  },
  // "Summarize the customer email volume by week", "Analyze our refund rate by month"
  {
    pattern:
      /\b(summari[sz]e|analy[sz]e|compare|review(?:s|ed|ing)?|report\s+on|break\s+down|track)\s+(?:the\s+|our\s+|their\s+|its\s+)?(?:[\p{L}'-]+\s+){0,3}(volumes?|rates?|costs?|spend(?:ing)?|numbers?|metrics?|trends?|history|breakdowns?|benchmarks?|totals?|averages?)\b/giu,
    replacement: "$1 an internal topic",
  },
  // "Compare payment processors", "Research secrets management tools"
  {
    pattern:
      /\b(compare|research(?:es|ed|ing)?|evaluate|review(?:s|ed|ing)?|shortlist|assess)\s+(?:the\s+|our\s+)?(?:[\p{L}'-]+\s+){0,2}(processors?|providers?|vendors?|tools?|tooling|platforms?|options?|templates?|software|suppliers?|services?|apps?)\b/giu,
    replacement: "$1 an internal topic",
  },
  // Noun collocations that share a word with a contact verb. Each of these was
  // a live false positive under the recipient rule below.
  {
    pattern:
      /\b(call|text|message|phone|email|post|release|sign|ping)[-\s](notes?|messages?|templates?|providers?|vendors?|logs?|history|volumes?|scripts?|transcripts?|quality|threads?|lists?|mortems?|up\b|off\b|data|records?)\b/gi,
    replacement: "internal $2",
  },
  { pattern: /\bterms\s+of\s+service\b/gi, replacement: "internal reference" },
  { pattern: /\b(content|kitchen|food|video|studio)\s+production\b/gi, replacement: "$1 work" },
  { pattern: /\bproduction\s+(capacity|schedule|quality|team|values?|costs?|process(?:es)?)\b/gi, replacement: "operational $1" },
];

function applyTopicMasks(segment: string): string {
  let masked = segment;
  for (const mask of TOPIC_MASKS) masked = masked.replace(mask.pattern, mask.replacement);
  return masked;
}

/**
 * Tokens that follow a contact verb but are never a person. The recipient rule
 * below is case-INSENSITIVE — an earlier version relied on `[A-Z][a-z]+` to
 * spot a name, which meant "text it to marco" (exactly what a transcript
 * produces) cleared while "text it to Marco" gated. Capitalization is decided
 * by a speech-to-text model and cannot carry a safety decision, so the rule
 * now gates any recipient token that is not on this list.
 */
const NON_PERSON_TOKENS = new Set([
  "notes", "note", "message", "messages", "template", "templates", "provider", "providers", "vendor", "vendors",
  "log", "logs", "list", "lists", "history", "volume", "center", "centre", "script", "scripts", "quality",
  "transcript", "transcripts", "record", "records", "data", "report", "reports", "summary", "thread", "threads",
  "board", "sheet", "tracker", "back", "out", "up", "in", "on", "off", "again", "later", "everyone", "anyone",
  "someone", "people", "team", "staff", "internal", "myself", "ourselves", "each", "both", "all", "the", "a", "an",
  "me", "us", "my", "our", "this", "that", "it", "them", "him", "her", "one", "some", "any", "about", "and", "or",
  // Adverbs and placeholders that follow a contact verb but name no one.
  // "forward it somewhere" must stay an honest "I could not tell", not become
  // a confident claim that a customer is being contacted.
  "somewhere", "anywhere", "everywhere", "elsewhere", "there", "here", "along", "ahead", "around", "onward",
  "today", "tomorrow", "tonight", "now", "soon", "first", "next", "then", "quickly", "please", "over", "through",
]);

const RECIPIENT_PATTERNS: RegExp[] = [
  /\b(?:text|message|ping|dm|slack|whatsapp|call|phone|ring|email|cc|notify|shoot|forward|tell)\s+(?:(?:it|this|that|them)\s+)?(?:to\s+|with\s+)?([\p{L}][\p{L}'-]{1,})\b/giu,
  // "let Marco know", "keep Priya posted" — the recipient sits between the verb
  // and the participle, so the pattern above cannot see it.
  /\b(?:let|keep|remind|update|brief)\s+([\p{L}][\p{L}'-]{1,})\s+(?:know|posted|informed|about|on\b)/giu,
  // "send it to Priya", "share it with Marco", "get the quote over to Marco"
  /\b(?:send|share|pass|give|forward|get|hand|walk)\s+(?:[\p{L}'-]+\s+){0,3}(?:to|with)\s+(?:the\s+|a\s+|an\s+)?([\p{L}][\p{L}'-]{1,})\b/giu,
];

/**
 * True when a contact verb is followed by something that reads as a person.
 * Runs on the MASKED segment, so "the call notes" and "text message providers"
 * have already become topics by the time this sees them.
 */
function mentionsNamedRecipient(masked: string): boolean {
  for (const pattern of RECIPIENT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of masked.matchAll(pattern)) {
      const recipient = match[1]?.toLowerCase();
      if (recipient && !NON_PERSON_TOKENS.has(recipient)) return true;
    }
  }
  return false;
}

const CATEGORY_RULES: Array<{ category: GatedCategory; level: CommandRiskLevel; pattern: RegExp }> = [
  {
    category: "customer_outreach",
    level: "high",
    pattern:
      // Verbs allow up to three qualifier words before their object, because
      // real speech puts words in between: "send the customer email", "forward
      // it over to the owner tonight", "get the quote across to Marco".
      //
      // "outreach" gates by DEFAULT, with a narrow exclusion list for the
      // research-noun collocations LYNQ actually uses ("outreach tooling",
      // "outreach numbers"). An earlier version had this polarity backwards —
      // it gated only an allowlist of action verbs, which let "prepare
      // outreach for the restaurant owners" clear completely. Default-gate
      // with named exceptions is the only safe direction here: a missing
      // exception costs an approval click, a missing verb costs a gate.
      /\b(?:cold[-\s]?(?:call|email)|outreach(?!\s+(?:tool|tools|tooling|software|platforms?|providers?|vendors?|stack|strategy|strategies|numbers?|metrics?|rates?|performance|results?|data|reports?|reporting|budget|costs?|options?|approach|process|playbooks?|templates?|copy|examples?|benchmarks?))|reach\s+out|email\s+(?:\w+\s+){0,3}(?:client|customer|prospect|lead|restaurant|owner|them|him|her)|(?:send|forward|deliver|share)\s+(?:\w+\s+){0,3}(?:email|message|dm|text|sms|proposal|pitch|invoice|newsletter|quote|note|summary|deck|link)|(?:send|forward|get|pass|run)\s+(?:\w+\s+){0,3}(?:to|over\s+to|out\s+to|across\s+to|by|in\s+front\s+of)\s+(?:the\s+|a\s+|an\s+)?(?:client|customer|prospect|lead|restaurant|owner|supplier|vendor|partner|them|him|her)|(?:send|forward)\s+(?:it|them|those|these)\s+(?:out|over|off)|follow[-\s]?up\s+with|contact\s+(?:\w+\s+){0,2}(?:client|customer|prospect|lead|restaurant|owner)|blast|campaign\s+send|mail\s?merge|(?:let|keep)\s+(?:the\s+)?(?:client|customer|owner|prospect|lead|supplier)\s+(?:know|posted|informed)|(?:notify|update|cc|bcc|reply\s+to|respond\s+to|mail|invite)\s+(?:the\s+)?(?:client|customer|prospect|lead|restaurant|owner|supplier|vendor)|check\s+in\s+with|touch\s+base|circle\s+back|drop\s+(?:\w+\s+){0,2}a\s+line|set\s+up\s+(?:a\s+)?(?:meeting|call|demo)\s+with|loop\s+in|enviar|envoyer|correo|courriel|nachricht)\b/i,
  },
  {
    category: "payment_or_spend",
    level: "critical",
    pattern:
      /\b(?:pay|pays|paid|paying|payments?|purchase(?!\s+(?:costs?|prices?|history|orders?|behaviou?rs?|patterns?|data|funnels?|process(?:es)?))|buy(?:s|ing)?(?!\s+(?:in\b|process|journey|cycle|behaviou?r|patterns?|signals?))|subscribe|subscriptions?|upgrade\s+the\s+plan|refunds?|invoice\s+them|charges?|wire|transfer\s+(?:funds|money|\$?\d)|top\s?up|billing|credit\s?card|budget\s+increase|spend|settle\s+(?:the\s+|up\b)|release\s+(?:\w+\s+){0,2}(?:payments?|funds|invoices?)|reimburse|payout|deposits?|place\s+(?:an?|the)\s+order|order\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|a\s+hundred|\w+\s+(?:from|for)\s+the)|move\s+\$?\d|move\s+\d+\s*k\b|renew\s+(?:our|the)\s+(?:\w+\s+){0,2}(?:plan|subscription|licen[cs]e|contract|credits?)|accept\s+(?:the\s+|their\s+)?(?:\w+\s+){0,2}quote|procure|expense\s+(?:it|the|this)|check\s?out\s+(?:the\s+)?cart)\b/i,
  },
  {
    category: "third_party_call",
    level: "high",
    pattern: /\b(?:call|phone|ring|dial|text)\s+(?:the\s+|a\s+|an\s+)?(?:client|customer|prospect|lead|restaurant|owner|supplier|vendor|partner|them|him|her|number)\b/i,
  },
  {
    category: "production_change",
    level: "critical",
    // `production` is required to be in a deployment context, never bare:
    // "review the content production process" and "analyze our production
    // capacity for the kitchen" are ordinary agency work, and gating them as
    // a live-site change was both wrong and confusingly explained. (Those two
    // shapes are also neutralized by TOPIC_MASKS before this runs.)
    pattern:
      /\b(?:deploy(?:s|ed|ing)?|promote|ship\s+(?:\w+\s+){0,4}(?:to\s+)?(?:prod|production|live|the\s+live\s+site)|release\s+(?:\w+\s+){0,3}(?:to\s+)?(?:prod|production|live)|cut\s+(?:a|the)\s+release|go\s+live|live\s+site|push\s+(?:\w+\s+){0,3}to\s+(?:main|master|production)|merge\s+(?:to|into)\s+(?:main|master)|(?:to|on|in|into)\s+production\b|production\s+(?:deploy|release|server|environment|branch|build|site)|prod\b|rollbacks?|roll\s+back|roll\s+(?:it|this|that)?\s*out\b|change\s+the\s+(?:alias|domain|dns)|point\s+the\s+domain|repoint|update\s+the\s+dns|cname|flip\s+(?:the\s+)?(?:feature\s+)?flag|(?:put|push|publish)\s+(?:\w+\s+){0,4}(?:on|to)\s+the\s+(?:site|website|homepage|landing\s+page)|make\s+(?:it|this|that)\s+available\s+to\s+(?:customers|everyone|the\s+public))\b/i,
  },
  {
    category: "destructive_change",
    level: "critical",
    pattern:
      /\b(?:delete(?:s|d)?|deleting|remove\s+(?:\w+\s+){0,3}(?:projects?|accounts?|records?|data|tables?|repos?|branch(?:es)?|duplicates?|files?|users?)|remove\s+(?:\w+\s+){0,3}permanently|drop\s+(?:the\s+)?(?:table|database)|wipe|purge|erase|truncate|revoke\s+access|deactivate|cancel\s+the\s+(?:account|subscription)|clear\s+(?:out\s+)?(?:the|all|our|any|every)\s+(?:\w+\s+){0,2}(?:database|data|records?|rows?|accounts?|tables?|logs?|history|files?|customers?|users?|projects?)|reset\s+(?:the|our|all)\s+(?:\w+\s+){0,2}(?:database|data|records?|accounts?|passwords?|environment)|empty\s+the\s+(?:table|database|bucket|queue)|take\s+down\s+(?:the|our)|shut\s+down\s+(?:the|our)|tear\s+down|destroy|get\s+rid\s+of\s+(?:the|all|our)|prune|overwrite|force[-\s]?push|unpublish|disable\s+(?:the\s+)?(?:account|user|integration|webhook))\b/i,
  },
  {
    category: "contract_or_legal",
    level: "critical",
    // `sign` must have a contract-shaped object. Bare `sign` matched "sign-up
    // funnel drop-off" and "sign off on the design review" — both routine, and
    // both then labelled "Signing or committing to an agreement".
    pattern:
      /\b(?:sign(?:s|ed|ing)?\s+(?:\w+\s+){0,3}(?:contracts?|agreements?|nda|msa|sow\b|retainer|deal|papers|offer|terms)|e[-\s]?sign|docusign|initial\s+the\s+(?:paperwork|contract|agreement)|contracts?|agreements?|nda\b|msa\b|statement\s+of\s+work|sow\b|legally\s+binding|commit\s+us\s+to|counter[-\s]?sign|retainer|agree\s+to\s+(?:the\s+)?(?:terms|contract|agreement|deal|proposal)|accept\s+(?:them|it)\s+on\s+our\s+behalf|close\s+the\s+deal)\b/i,
  },
  {
    category: "credential_access",
    level: "critical",
    pattern:
      /\b(?:api\s?keys?|access\s?tokens?|secrets?|credentials?|passwords?|env\s+(?:vars?|variables?|file)|environment\s+variables?|private\s?keys?|ssh\s+keys?|rotate\s+(?:\w+\s+){0,2}(?:keys?|credentials?|secrets?|tokens?|them)|service\s+account|read\s+(?:me\s+)?(?:the\s+|what(?:'s|\s+is)\s+in\s+the\s+)?\.?env|(?:read|tell|give)\s+me\s+(?:the\s+)?(?:\w+\s+){0,2}(?:key|token|secret|password|login|credentials?|connection\s+string)|connection\s+string|admin\s+(?:login|password|access)|grant\s+(?:\w+\s+){0,2}(?:admin|owner|root|write)\s+access|invite\s+(?:a\s+|an\s+)?(?:new\s+)?(?:admin|owner)\b)/i,
  },
  {
    category: "public_publishing",
    level: "high",
    pattern:
      /\b(?:publish(?:es|ed|ing)?|(?:post|share|put|get|upload)\s+(?:it\s+|this\s+|that\s+|them\s+)?(?:up\s+)?(?:to|on)\s+(?:linkedin|instagram|facebook|x\b|twitter|tiktok|youtube|reddit|our\s+socials?|social\s+media|the\s+blog|the\s+site)|go\s+public|announce\s+publicly|press\s+release|tweet)\b/i,
  },
  {
    category: "personnel",
    level: "high",
    pattern:
      /\b(?:hire|fire|terminate\s+(?:the\s+)?employee|lay\s+off|let\s+[\p{L}'-]+\s+go\b|raise\s+(?:their|his|her)\s+(?:salary|pay)|bump\s+(?:\w+\s+){0,3}to\s+\$?\d|offer\s+letter|make\s+(?:\w+\s+){0,2}an?\s+offer|extend\s+an\s+offer|bring\s+on\s+(?:a|an|the)|onboard\s+(?:a|an|the)\s+(?:new\s+)?(?:contractor|hire|employee|designer|developer|engineer)|(?:change|raise|set|approve|adjust)\s+(?:\w+\s+){0,2}compensation)\b/iu,
  },
];

/**
 * Phrases that try to talk past the gate. These never reduce risk — matching
 * one raises the command to `critical` and is recorded, because an
 * instruction that argues for skipping approval is exactly the instruction
 * that most needs one.
 */
const OVERRIDE_ATTEMPT_PATTERN =
  /\b(?:skip\s+(?:the\s+)?(?:approval|review|check|gate)|no\s+(?:need\s+(?:for|to)\s+)?(?:approval|approve|review|sign[-\s]?off)(?:\s+(?:needed|required|necessary))?|without\s+(?:approval|asking|confirming|review|waiting)|don'?t\s+(?:ask|wait|confirm)|do\s+not\s+(?:ask|wait|confirm)|bypass|override|waive\s+the\s+(?:approval|review)|i\s+(?:already\s+)?(?:approve|approved|authorize|authorized|signed\s+off)|(?:pre[-\s]?approved|already\s+approved|already\s+authorized|already\s+signed\s+off)|signed\s+off\s+on\s+(?:it|this|that)|consider\s+(?:it|this)\s+approved|treat\s+this\s+as\s+approved|you\s+(?:have|got)\s+my\s+(?:approval|permission|sign[-\s]?off)|green\s?light|go\s+ahead\s+without|proceed\s+(?:on\s+your\s+own|without)|you'?re\s+cleared|just\s+do\s+it|emergency,?\s+(?:just\s+)?(?:do|send|deploy|pay)|urgent,?\s+(?:just\s+)?(?:do|send|deploy|pay)|trust\s+me|no\s+questions)\b/i;

/**
 * Verbs whose outward or irreversible effect is in the VERB itself, so they
 * gate however much planning language surrounds them and wherever in the text
 * they appear. This is the whole-text net; the clause rule below is the
 * clause-level one.
 *
 * Words that are far more often NOUNS in this domain are deliberately absent —
 * `call`, `post`, `text`, `message`, `release`, `remove`, `drop`, `sign`. Their
 * genuine verb forms are already covered by the categories above ("call the
 * client", "post to LinkedIn", "release the payments", "remove the records"),
 * while including them here gated "summarize the call notes", "the post mortem
 * document", "the release notes" and "research text message providers". A
 * backstop that fires on ordinary nouns does not make the system safer; it
 * teaches the founder to approve without reading.
 */
const HARD_EFFECT_PATTERN =
  /\b(?:send|sends|sending|sent|forward|forwards|forwarding|forwarded|deliver|delivers|delivered|email|emails|emailed|emailing|dm|publish|publishes|publishing|pay|pays|paying|paid|charge|charges|refund|transfer(?!\s+(?:fees?|costs?|rates?|pricing|process(?:es)?|times?|speed|volumes?))|wire|deploy|deploys|deploying|deployed|wipe|purge|erase|rotate|rotates|rotating|revoke|revokes|hire|fire|terminate|settle|reimburse|docusign|unpublish)\b/i;

/**
 * Work that is genuinely internal, reversible, and produces a document rather
 * than an external effect. Matching this is necessary but NOT sufficient to
 * clear a command: it must also match no gated category, no hard effect, and
 * every command-shaped clause must match it too.
 *
 * This list is deliberately generous. Under the clause rule an unrecognized
 * internal verb costs an approval click on ordinary work, so the cost of a
 * gap here is friction — and friction, repeated, is what makes a founder stop
 * reading the gates that matter.
 */
const INTERNAL_WORK_PATTERN =
  /\b(?:research|analy[sz]e|analysis|review|summari[sz]e|summary|summaries|draft|outline|plan|prepare|write\s+(?:up|out|a\b|an\b|the\b)|brainstorm|compare|comparison|investigate|look\s+(?:into|at|through)|go\s+through|dig\s+into|organi[sz]e|categori[sz]e|group|sort|rank|document|audit\s+(?:the\s+)?(?:copy|content|site|process)|estimate|scope|strategy|strategies|roadmap|checklist|report|notes?\b|brief|memo|deck|overview|breakdown|break\s+down|recap|findings|options|shortlist|evaluate|assess|benchmark|map\s+out|identify|find\s+out|figure\s+out|tell\s+me|show\s+me|walk\s+me\s+through|explain|propose|recommend|suggest|sketch|mock\s+up|put\s+together|pull\s+together|list\s+(?:the|out|all)|cross[-\s]?reference|track|monitor|internal\s+topic)\b/i;

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

/** Bounded so a pathological transcript cannot make classification expensive. Well above any real spoken command. */
const MAX_SUBJECT_LENGTH = 8000;

/**
 * Splits into clause-sized segments. Sentence terminators always split;
 * commas and coordinators split only ahead of something command-shaped.
 */
function splitSegments(subject: string): string[] {
  return subject
    .split(COORDINATOR)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

/**
 * Classifies the full text a command was derived from. Callers pass every
 * field that carries founder intent (outcome, target, constraints, proposed
 * steps, open questions, requested integrations) concatenated — a gated verb
 * hiding in any of them must gate the command just as surely as one in the
 * headline outcome.
 */
export function assessCommandRisk(text: string): CommandRiskAssessment {
  const subject = (text ?? "").trim().slice(0, MAX_SUBJECT_LENGTH);
  if (!subject) {
    return {
      level: "medium",
      requiresApproval: true,
      gatedCategories: [],
      reasons: ["Jarvis could not tell what was being asked for, so it stopped for your decision."],
      overrideAttempted: false,
    };
  }

  const segments = splitSegments(subject);
  const maskedSegments = segments.map(applyTopicMasks);
  const maskedSubject = maskedSegments.join(" \n ");

  const gatedCategories: GatedCategory[] = [];
  let level: CommandRiskLevel = "low";
  const addCategory = (category: GatedCategory, ruleLevel: CommandRiskLevel) => {
    if (!gatedCategories.includes(category)) gatedCategories.push(category);
    level = maxLevel(level, ruleLevel);
  };

  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(maskedSubject)) addCategory(rule.category, rule.level);
  }
  // Checked per segment so a contact verb in one clause cannot be paired with a
  // recipient-shaped word in the next.
  if (maskedSegments.some(mentionsNamedRecipient)) addCategory("customer_outreach", "high");

  // The override check runs on the RAW text: masking exists to stop topics from
  // reading as actions, and must never soften an attempt to talk past the gate.
  const overrideAttempted = OVERRIDE_ATTEMPT_PATTERN.test(subject);
  if (overrideAttempted) level = "critical";

  const reasons: string[] = gatedCategories.map((category) => GATED_CATEGORY_LABELS[category]);
  if (overrideAttempted) {
    reasons.unshift("The instruction asked to skip approval. Jarvis kept the approval in place.");
  }

  if (gatedCategories.length === 0 && !overrideAttempted) {
    // Fail closed, but say WHAT stopped it. "Jarvis could not confirm this is
    // internal work" is honest and useless; naming the word or the clause lets
    // the founder either approve immediately or rephrase, and makes an
    // over-cautious gate visible instead of mysterious.
    const hardEffect = maskedSubject.match(HARD_EFFECT_PATTERN)?.[0];
    if (hardEffect) {
      // Named, but deliberately NOT escalated past `medium`: this branch is
      // "an effect word appeared and no category recognized the shape", which
      // is a statement about Jarvis's certainty, not about severity. Claiming
      // `high` here would make an over-cautious gate sound authoritative.
      return {
        level: "medium",
        requiresApproval: true,
        gatedCategories: [],
        reasons: [`Jarvis saw "${hardEffect.toLowerCase()}" and could not tell whether this reaches outside LYNQ, so it stopped for your decision`],
        overrideAttempted: false,
      };
    }

    // THE clause rule. Every segment that reads as a command must itself read
    // as internal work. This is what stops a planning verb at the front of a
    // sentence from vouching for whatever follows it.
    const unclearedIndex = maskedSegments.findIndex(
      (masked) => PREDICATE_SHAPE.test(masked) && !INTERNAL_WORK_PATTERN.test(masked)
    );
    if (unclearedIndex !== -1) {
      const spoken = segments[unclearedIndex].replace(/\s+/g, " ").slice(0, 80);
      return {
        level: "medium",
        requiresApproval: true,
        gatedCategories: [],
        reasons: [`Jarvis could not tell that "${spoken}" is internal work, so it stopped for your decision`],
        overrideAttempted: false,
      };
    }

    if (INTERNAL_WORK_PATTERN.test(maskedSubject)) {
      return { level: "low", requiresApproval: false, gatedCategories: [], reasons: [], overrideAttempted: false };
    }

    return {
      level: "medium",
      requiresApproval: true,
      gatedCategories: [],
      reasons: ["Jarvis could not tell whether this is internal, reversible work, so it stopped for your decision"],
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
