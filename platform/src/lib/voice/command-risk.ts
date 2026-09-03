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
 * ## Why clearance is an allowlist
 *
 * This decision has now been designed four times, and the first three are the
 * argument for the fourth. Each was a DENYLIST — enumerate what is dangerous,
 * clear everything else — and each was walked past within a day:
 *
 *   A. Clearance needed one internal verb anywhere in the string.
 *      "Draft the plan and clear the production database tonight" cleared.
 *   B. Per-clause clearance, plus masks that rewrote risky-sounding topics so a
 *      write-up ABOUT something risky did not read as the risky thing. The
 *      masks consumed a window of following text before any rule ran:
 *      "Draft a runbook for tomorrow delete the customer records" cleared.
 *   C. Masks removed; a list of outward verbs refused a clause outright. Every
 *      test was anchored at `^`, so one filler word made a clause unexaminable:
 *      "Please cancel the Acme order and note it in the summary" cleared, along
 *      with 37 of the 65 verbs on that list.
 *
 * The pattern is not that three people were careless. It is that the set of
 * ways to say "do something irreversible" is not enumerable, and the failure
 * direction of a miss is silent.
 *
 * So the decision is inverted. A clause clears only when its HEAD VERB is on a
 * short, explicit list of research and authoring verbs (or, for a handful of
 * verbs that are ordinary document work with a document as their object, when
 * that object is one too). Everything else gates: an unrecognized verb, an
 * unusual phrasing, another language, a verb someone invents next year.
 *
 * The categories and the effect backstop still run, but they no longer decide
 * whether work starts — they make the REASON specific and the level honest. A
 * gap in them costs a vaguer explanation, not a silent external action.
 *
 * Two rules follow, and both are enforced by tests:
 *
 *   1. **Nothing here may rewrite or delete text.** Narrowings are zero-width
 *      lookarounds bound to the word they attach to. That is what design B got
 *      wrong.
 *   2. **Every test that reads a clause must first strip what sits in front of
 *      the verb.** Politeness, adverbs and lead-in phrases are how people
 *      actually talk. That is what design C got wrong.
 *
 * The cost is over-gating, and it is measured rather than assumed: a corpus of
 * forty realistic internal instructions lives in the tests, and the gate is
 * expected to clear all of them. If a change makes that corpus gate, the
 * change is wrong — a gate that fires on ordinary work teaches the founder to
 * approve without reading, which is what makes every real gate here worthless.
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
 * Verbs that are unambiguously "do something outward or irreversible". A
 * segment that OPENS with one of these can never be cleared by the clause rule,
 * whatever else it contains.
 *
 * The unconditional part matters. INTERNAL_WORK_PATTERN necessarily contains
 * bare nouns — `notes`, `plan`, `report`, `summary` — because that is how
 * research gets described, and one incidental noun inside a real command was
 * enough to clear it:
 *
 *     "Cancel the Acme order per the notes"    ->  low   (matched `notes`)
 *     "Approve the invoice in the plan"        ->  low   (matched `plan`)
 *     "Book the flights for the team report"   ->  low   (matched `report`)
 *
 * Research verbs (`review`, `draft`, `compare`, `analyze`, `put together`) are
 * deliberately absent, so ordinary work is untouched.
 */
const COMMAND_VERB_HINT =
  "cancel|approve|order|buy|purchase|pay|wire|transfer|refund|charge|spend|expense|reimburse|" +
  "send|forward|email|call|text|message|ping|dm|slack|notify|reply|contact|unsubscribe|invite|" +
  "deploy|ship|publish|unpublish|push|merge|release|upload|" +
  "delete|remove|wipe\b(?!\s+(?:procedur|process|polic|guides?|runbooks?))|purge|erase|drop|clear|reset|archive|destroy|revoke|rotate|disable|" +
  "hire|fire|onboard|offboard|promote|bump|" +
  // `sign off` and `sign up` are ordinary review and product language, not
  // signing an agreement.
  "sign(?!\\s+(?:off|up))|agree|accept|grant|renew|subscribe|place|extend|launch|book|schedule";

/** The broader "something is being done" list, used only to find clause boundaries. */
const ACTION_VERB_HINT =
  `${COMMAND_VERB_HINT}|start|run|process|handle|action|share|post|tell|let|keep|read|give|move|take|shut|reach`;

/**
 * Where a new clause begins.
 *
 * Sentence terminators split UNCONDITIONALLY. They used to be gated on the
 * same predicate lookahead as the coordinators, which meant a second sentence
 * whose object was a bare plural noun was never examined at all:
 *
 *     "Draft the launch plan. Order tablets from Acme."   ->  low
 *     "Summarize the notes. Unsubscribe Marco."           ->  low
 *
 * `\n` is a terminator too, and `buildCommandDraft` joins its fields with it,
 * so this also stops one field vouching for the next.
 *
 * Commas and coordinators still split conditionally — splitting them
 * unconditionally would tear ordinary lists apart ("Compare Instantly and
 * Gojiberry for outreach tooling") and gate half the work LYNQ actually does.
 * The condition is now EITHER a determiner-shaped object (the original test)
 * OR a known action verb, so "and clear production databases" splits while
 * "and Gojiberry for outreach tooling" does not.
 */
const SENTENCE_BOUNDARY = /[.;!?\n]+/;

/**
 * The coordinator LITERALS, with no lookahead.
 *
 * The lookahead used to be part of this pattern, which meant the engine tried
 * a seventy-alternative verb list at every character position: `", "` repeated
 * to the length cap cost 760ms of blocked event loop per webhook. The same
 * decision is now made once per candidate piece in `splitSegments`, which is
 * linear in the number of pieces rather than in characters times alternatives.
 */
const COORDINATOR = /(?:,\s+|\s+(?:and\s+then|and|then|also|plus|next|after\s+that|followed\s+by)\s+)/iu;

/**
 * ============================================================================
 * Why there is no text rewriting here
 * ============================================================================
 * A previous version reduced over-gating with TOPIC_MASKS: patterns that
 * rewrote "the wipe procedure" or "research what an NDA covers" into a neutral
 * phrase before the rules ran, so a document ABOUT something risky did not read
 * as the risky thing itself.
 *
 * They were a hole, and a bad one. Each mask consumed a bounded window of
 * FOLLOWING text (`[^.;,]{0,60}`), and masking ran before every rule — so the
 * window deleted whatever action was sitting inside it, and no category, no
 * effect word and no clause check ever saw it:
 *
 *     "Draft a runbook for tomorrow delete the customer records"  ->  low
 *     "Document what you find then deploy to production"          ->  low
 *     "Write a policy for how we wire fifty thousand to Acme"     ->  low
 *
 * Worse, the replacements injected the phrase "internal topic", which
 * INTERNAL_WORK_PATTERN matched — so a mask hit could manufacture the very
 * evidence of internal work the clause rule then demanded.
 *
 * Reducing over-gating is still worth doing, but never with a rule that can
 * delete text. What replaces them is a set of zero-width negative lookarounds
 * bound to the matched noun itself, inside the category patterns and the
 * effect backstop. One can decline to fire on "password policy"; none of them
 * can reach past the word it is attached to. A narrowing that cannot consume
 * cannot hide an action.
 *
 * Note the `\b` before each lookahead on an optional plural. Without it the
 * narrowing is trivially evaded: `secrets?(?!\s+management)` happily matches
 * the "secret" inside "secrets management", because the lookahead then sees an
 * "s" rather than a space.
 */

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
  // Prepositions are never a recipient.
  "for", "from", "about", "with", "at", "by", "of", "per", "via", "into", "onto", "during", "after", "before",
  "today", "tomorrow", "tonight", "now", "soon", "first", "next", "then", "quickly", "please", "over", "through",
]);

const RECIPIENT_PATTERNS: RegExp[] = [
  /\b(?:text|message|ping|dm|slack|whatsapp|call|phone|ring|email|cc|notify|shoot|forward|tell)\s+(?:(?:up|out|over|back)\s+)?(?:(?:it|this|that|them)\s+)?(?:to\s+|with\s+)?([\p{L}][\p{L}'-]{1,})\b/giu,
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
      /\b(?:cold[-\s]?(?:call|email)|outreach(?!\s+(?:tool|tools|tooling|software|platforms?|providers?|vendors?|stack|strategy|strategies|numbers?|metrics?|rates?|performance|results?|data|reports?|reporting|budget|costs?|options?|approach|process|playbooks?|templates?|copy|examples?|benchmarks?))|reach\s+out|email\s+(?:\w+\s+){0,3}(?:client|customer|prospect|lead|restaurant|owner|them|him|her)(?!\s+(?:volume|counts?|lists?|addresses|templates?))|(?:send|forward|deliver|share)\s+(?:\w+\s+){0,3}(?:email|message|dm|text|sms|proposal|pitch|invoice|newsletter|quote|note|summary|deck|link)|(?:send|forward|get|pass|run)\s+(?:\w+\s+){0,3}(?:to|over\s+to|out\s+to|across\s+to|by|in\s+front\s+of)\s+(?:the\s+|a\s+|an\s+)?(?:client|customer|prospect|lead|restaurant|owner|supplier|vendor|partner|them|him|her)|(?:send|forward)\s+(?:it|them|those|these)\s+(?:out|over|off)|follow[-\s]?up\s+with|contact\s+(?:\w+\s+){0,2}(?:client|customer|prospect|lead|restaurant|owner)|blast|campaign\s+send(?!\s+costs?)|mail\s?merge|(?:let|keep)\s+(?:the\s+)?(?:client|customer|owner|prospect|lead|supplier)\s+(?:know|posted|informed)|(?:notify|update|cc|bcc|reply\s+to|respond\s+to|mail|invite)\s+(?:the\s+)?(?:client|customer|prospect|lead|restaurant|owner|supplier|vendor)|check\s+in\s+with|touch\s+base|circle\s+back|drop\s+(?:\w+\s+){0,2}a\s+line|(?:set\s+up|book|schedule|arrange)\s+(?:\w+\s+){0,3}(?:meeting|call|demo|time|slot)?\s*with\s+(?:the\s+)?(?:client|customer|prospect|lead|owner|supplier|vendor|partner|them|him|her)|loop\s+in|enviar|envoyer|correo|courriel|nachricht)\b/i,
  },
  {
    category: "payment_or_spend",
    level: "critical",
    pattern:
      /\b(?:pay|pays|paid|paying|payments?\b(?!\s+(?:processors?|providers?|gateways?|polic|terms|schedule|methods?|rails?))|purchase(?!\s+(?:costs?|prices?|history|behaviou?rs?|patterns?|data|funnels?|process(?:es)?|order\s+(?:history|process|templates?)))|buy(?:s|ing)?(?!\s+(?:in\b|process|journey|cycle|behaviou?r|patterns?|signals?))|subscribe|subscriptions?|upgrade\s+the\s+plan|refunds?\b(?!\s+(?:rates?|polic|process|procedur|volume|reasons?))|invoice\s+them|charges?\s+(?:the\s+|their\s+|his\s+|her\s+)?(?:client|customer|card|account|them|him|her|us)\b|wire|transfer\s+(?:funds|money|\$?\d[\d,.]*)|top\s?up|billing|credit\s?card|budget\s+increase|(?<!how\s+much\s+we\s+)spend(?!ing\s+(?:polic|process))|settle\s+(?:the\s+|up\b)|release\s+(?:\w+\s+){0,2}(?:payments?|funds|invoices?)|reimburse|payout|deposits?|place\s+(?:an?|the)\s+order|order\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|a\s+hundred|\w+\s+(?:from|for)\s+the)|move\s+\$?\d[\d,.]*|move\s+\d+\s*k\b|renew\s+(?:our|the)\s+(?:\w+\s+){0,2}(?:plan|subscription|licen[cs]e|contract|credits?)|accept\s+(?:the\s+|their\s+)?(?:\w+\s+){0,2}quote|procure|expense\s+(?:it|the|this)|check\s?out\s+(?:the\s+)?cart)\b/i,
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
    // shapes are also narrowed by the lookarounds in this pattern.)
    pattern:
      /\b(?:deploy(?:s|ed|ing)?(?!\s+(?:process(?:es)?|procedur|polic|guides?|pipelines?|checklists?|runbooks?|schedule|frequency|cadence|steps?|docs?))|promote\s+(?:it\s+|this\s+|that\s+)?(?:to\s+)?(?:prod|production|live|the\s+live\s+site|the\s+release)\b|ship\s+(?:\w+\s+){0,4}(?:to\s+)?(?:prod|production|live|the\s+live\s+site)|release\s+(?:\w+\s+){0,3}(?:to\s+)?(?:prod|production|live)|cut\s+(?:a|the)\s+release|go(?:es)?\s+live|going\s+live|live\s+site|push\s+(?:\w+\s+){0,3}to\s+(?:main|master|production)|merge\s+(?:to|into)\s+(?:main|master)|(?:to|on|in|into)\s+production\b|production\s+(?:deploy|release|server|environment|branch|build|site)|prod\b|rollbacks?\b(?!\s+(?:procedur|process|polic|plans?|guides?|runbooks?|steps?))|roll\s+back|roll\s+(?:it|this|that)?\s*out\b|change\s+the\s+(?:alias|domain|dns)|point\s+the\s+domain|repoint|update\s+the\s+dns|cname|flip\s+(?:the\s+)?(?:feature\s+)?flag|(?:put|push|publish)\s+(?:\w+\s+){0,4}(?:on|to)\s+the\s+(?:site|website|homepage|landing\s+page)|make\s+(?:it|this|that)\s+available\s+to\s+(?:customers|everyone|the\s+public))\b/i,
  },
  {
    category: "destructive_change",
    level: "critical",
    pattern:
      /\b(?:delet(?:e|es|ed|ing)|remove\s+(?:\w+\s+){0,3}(?:projects?|accounts?|records?|data|tables?|repos?|branch(?:es)?|duplicates?|files?|users?)|remove\s+(?:\w+\s+){0,3}permanently|drop\s+(?:\w+\s+){0,3}(?:tables?|databases?|schemas?|collections?|indexes|indices)|wipe(?:s|d)?(?!\s+(?:procedur|process|polic|guides?|runbooks?))|purg(?:e|es|ed)|eras(?:e|es|ed)|truncat(?:e|es|ed)|(?<!how\s+we\s+)revoke\s+access|deactivat(?:e|es|ed)|archiv(?:e|es|ed)\s+(?:\w+\s+){0,3}(?:accounts?|records?|customers?|users?|data)|cancel\s+the\s+(?:account|subscription)|clear\s+(?:out\s+)?(?:the|all|our|any|every)\s+(?:\w+\s+){0,2}(?:database|data|records?|rows?|accounts?|tables?|logs?|history|files?|customers?|users?|projects?)|reset\s+(?:the|our|all)\s+(?:\w+\s+){0,2}(?:database|data|records?|accounts?|passwords?|environment)|empty\s+the\s+(?:table|database|bucket|queue)|take\s+down\s+(?:the|our)|shut\s+down\s+(?:the|our)|tear\s+down|destroy|get\s+rid\s+of\s+(?:the|all|our)|prune|overwrite|force[-\s]?push|unpublish|disable\s+(?:the\s+)?(?:account|user|integration|webhook))\b/i,
  },
  {
    category: "contract_or_legal",
    level: "critical",
    // `sign` must have a contract-shaped object. Bare `sign` matched "sign-up
    // funnel drop-off" and "sign off on the design review" — both routine, and
    // both then labelled "Signing or committing to an agreement".
    pattern:
      /\b(?:sign(?:s|ed|ing)?\s+(?:\w+\s+){0,3}(?:contracts?|agreements?|nda|msa|sow\b|retainer|deal|papers|offer|terms)|e[-\s]?sign|docusign|initial\s+the\s+(?:paperwork|contract|agreement)|contracts?\b(?!\s+(?:templates?|polic|process|management|software|law\b|lifecycle))|agreements?\b(?!\s+templates?)|nda\b(?!\s+(?:templates?|polic|usually|typically|generally))|msa\b|statement\s+of\s+work|sow\b|legally\s+binding|commit\s+us\s+to|counter[-\s]?sign|(?:sign|agree|start|end|renew)\s+(?:the\s+)?retainer|agree\s+to\s+(?:the\s+)?(?:terms|contract|agreement|deal|proposal)|accept\s+(?:them|it)\s+on\s+our\s+behalf|close\s+the\s+deal)\b/i,
  },
  {
    category: "credential_access",
    level: "critical",
    pattern:
      /\b(?:(?<!handle\s)(?<!handling\s)(?<!manage\s)(?<!managing\s)(?<!store\s)(?<!storing\s)api\s?keys?\b(?!\s+(?:polic|management|rotation))|access\s?tokens?|secrets?\b(?!\s+(?:management|manager|store|storage|scanning|handling|hygiene))|credentials?\b(?!\s+(?:polic|procedur|process|guide|management|hygiene))|passwords?\b(?!\s+(?:polic|manager|hygiene|standards?|requirements?|rules?|reset))|env\s+(?:vars?|variables?|file)|environment\s+variables?|private\s?keys?|ssh\s+keys?|rotate\s+(?:\w+\s+){0,2}(?:keys?|credentials?|secrets?|tokens?|them)|service\s+account|read\s+(?:me\s+)?(?:the\s+|what(?:'s|\s+is)\s+in\s+the\s+)?\.?env|(?:read|tell|give)\s+me\s+(?:the\s+)?(?:\w+\s+){0,2}(?:key|token|secret|password|login|credentials?|connection\s+string)|connection\s+string|admin\s+(?:login|password|access)|(?:grant|give|add)\s+(?:\w+\s+){0,2}(?:admin|owner|root|write)\s+access|add\s+(?:\w+\s+){0,2}as\s+(?:an?\s+)?(?:admin|owner)|invite\s+(?:a\s+|an\s+)?(?:new\s+)?(?:admin|owner)\b)/i,
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
      /\b(?:hire(?!\s+(?:more\s+)?(?:efficiently|effectively|better|faster|smarter))|fire|terminate\s+(?:the\s+)?employee|lay\s+off|let\s+[\p{L}'-]+\s+go\b|raise\s+(?:their|his|her)\s+(?:salary|pay)|bump\s+(?:\w+\s+){0,3}to\s+\$?\d[\d,.]*|offer\s+letters?\b(?!\s+templates?)|make\s+(?:\w+\s+){0,2}an?\s+offer|extend\s+an\s+offer|bring\s+on\s+(?:a|an|the)|onboard\s+(?:a|an|the)\s+(?:new\s+)?(?:contractor|hire|employee|designer|developer|engineer)|(?:change|raise|set|approve|adjust)\s+(?:\w+\s+){0,2}compensation)\b/iu,
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
  /\b(?:send\b(?!\s+costs?)|sends|sending|sent|forward|forwards|forwarding|forwarded|deliver|delivers|delivered|emails?\b(?!\s+(?:volumes?|counts?|lists?|addresses|templates?|providers?|clients?|marketing))|emailed|emailing|dm|publish|publishes|publishing|pay|pays|paying|paid|charges?\s+(?:the\s+|their\s+|his\s+|her\s+)?(?:client|customer|card|account|them|him|her|us)\b|refunds?\b(?!\s+(?:rates?|polic|process|procedur|volume|reasons?))|transfer(?!\s+(?:fees?|costs?|rates?|pricing|process(?:es)?|times?|speed|volumes?))|wire|deploy(?:s|ed|ing)?\b(?!\s+(?:process(?:es)?|procedur|polic|guides?|pipelines?|checklists?|runbooks?|schedule|frequency|cadence|steps?|docs?))|wipe\b(?!\s+(?:procedur|process|polic|guides?|runbooks?))|purge|erase|rotate|rotates|rotating|(?<!how\s+we\s+)revokes?\b|hire\b(?!\s+(?:more\s+)?(?:efficiently|effectively|better|faster|smarter))|fire|terminate|settle|reimburse|docusign|unpublish)\b/i;

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
/**
 * Well above anything a spoken command produces, and — deliberately — above
 * what `toDirectiveInstruction` can ship. `buildCommandDraft` can assemble a
 * ~14 000-character subject from its bounded fields while the Office
 * instruction caps at 5 000, so a lower value here would let the classifier
 * truncate text the planner still receives. The classifier must never see less
 * than the planner does. Every pattern in this file is linear, so the larger
 * bound costs nothing measurable.
 */
const MAX_SUBJECT_LENGTH = 20_000;

/**
 * How many clauses one command may contain before it stops being a spoken
 * instruction and starts being a denial-of-service payload.
 *
 * Every pattern here is linear in the length of a segment, but the per-segment
 * work is repeated once per segment — so `", "` repeated to the length cap
 * produced ten thousand clauses and 760ms of blocked event loop per webhook.
 * No real command has more than a handful. Exceeding this gates, which is both
 * the fail-closed direction and the honest description of a string nobody
 * said.
 */
const MAX_SEGMENTS = 200;

/**
 * Splits into clause-sized segments. Sentence terminators always split;
 * commas and coordinators split only ahead of something command-shaped.
 */
interface Segment {
  text: string;
  /** True when this segment is a whole sentence rather than something split off at a comma or conjunction. */
  fromSentence: boolean;
}

function splitSegments(subject: string): Segment[] {
  const segments: Segment[] = [];
  for (const sentence of subject.split(SENTENCE_BOUNDARY)) {
    const pieces = sentence.split(COORDINATOR);
    pieces.forEach((piece, index) => {
      const text = piece.trim();
      if (!text) return;
      if (index === 0) {
        segments.push({ text, fromSentence: true });
        return;
      }
      // A piece after a coordinator is a new clause only if it READS like one.
      // Otherwise it is a list continuation ("…and Gojiberry for outreach
      // tooling") and belongs to the clause before it — splitting there would
      // ask a noun phrase to prove it is research work.
      const head = stripToHead(text);
      const startsClause = OPENS_WITH_ACTION_VERB.test(head) || RESEARCH_HEAD_PATTERN.test(head) || PREDICATE_SHAPE.test(head);
      if (startsClause || segments.length === 0) {
        segments.push({ text, fromSentence: false });
      } else {
        segments[segments.length - 1].text += ` ${text}`;
      }
    });
  }
  return segments;
}

const OPENS_WITH_ACTION_VERB = new RegExp(`^[^A-Za-z0-9]*(?:${ACTION_VERB_HINT})\\b`, "iu");

/**
 * ============================================================================
 * Clearance is an ALLOWLIST over the head verb of every clause
 * ============================================================================
 * This is the fourth design of this decision, and the reason for the change is
 * the first three:
 *
 *   A. Clearance needed one internal verb anywhere in the string. "Draft the
 *      plan and clear the production database tonight" cleared.
 *   B. Per-clause clearance, plus masks that rewrote risky-sounding topics.
 *      The masks deleted a window of following text before any rule ran, so
 *      "Draft a runbook for tomorrow delete the customer records" cleared.
 *   C. Masks removed, replaced by a list of outward verbs that refuse a clause
 *      outright. Every test in it was anchored at `^`, so one filler word made
 *      a clause unexaminable: "Please cancel the Acme order and note it in the
 *      summary" cleared, as did 37 of the 65 verbs in that list.
 *
 * Each of those was a DENYLIST: enumerate what is dangerous, clear everything
 * else. Three rounds of that produced three critical holes, because the list of
 * ways to say "do something irreversible" is not enumerable and the failure
 * direction of a miss is silent.
 *
 * So the decision is inverted. A clause clears only when its HEAD VERB is on a
 * short, explicit list of research and authoring verbs. Everything else gates:
 * an unrecognized verb, an unusual phrasing, another language, a verb someone
 * invents next year. The categories and the effect backstop still run, but they
 * no longer decide whether work starts — they only make the REASON specific and
 * the level honest. A gap in them now costs a vaguer explanation, not a silent
 * external action.
 *
 * The cost is over-gating, and it is real. It is also visible, one click to
 * resolve, and — unlike the three holes above — it is the failure a founder can
 * see happening.
 */

/**
 * Politeness, adverbs and lead-in phrases that sit in front of the verb. A real
 * founder says "please cancel that" far more often than "cancel that", and
 * under design C the word "please" was enough to make the rest of the sentence
 * invisible to every check in this file.
 */
const LEADING_NOISE =
  /^(?:[^\p{L}\d]*(?:please|kindly|now|just|today|tomorrow|tonight|then|also|next|first|finally|quickly|asap|ok|okay|so|and|but|well|actually|maybe|perhaps|hey|jarvis|alright|right|sure|yeah|yes|um|uh|like|basically|honestly|obviously)\b[\s,]*)+/iu;

const LEAD_IN_PHRASE =
  /^(?:[^\p{L}\d]*(?:i(?:'d| would)?\s+(?:need|want|like)\s+you\s+to|i\s+need\s+you\s+to|i\s+want\s+to|can\s+you|could\s+you|would\s+you|will\s+you|we\s+should|we\s+need\s+to|let'?s|make\s+sure\s+to|be\s+sure\s+to|go\s+ahead\s+and|remember\s+to|don'?t\s+forget\s+to|see\s+if\s+you\s+can|try\s+to|help\s+me|it\s+would\s+be\s+good\s+to|your\s+job\s+is\s+to|the\s+task\s+is\s+to)\b[\s,]*)+/iu;

/** Strips everything in front of the verb, repeatedly, until the head is exposed. */
function stripToHead(segment: string): string {
  let text = segment.trim();
  for (let pass = 0; pass < 6; pass += 1) {
    const next = text.replace(LEAD_IN_PHRASE, "").replace(LEADING_NOISE, "").trim();
    if (next === text) break;
    text = next;
  }
  return text;
}

/**
 * The verbs that may start work without a human decision. Short on purpose,
 * and deliberately only research and authoring: everything here produces a
 * document, a comparison or an answer, and nothing here leaves LYNQ, spends
 * anything, or cannot be undone.
 *
 * Adding a verb to this list is a safety change and should be treated as one.
 * Leaving one out costs an approval click.
 */
const RESEARCH_HEAD =
  "sign\\s+off|put\\s+together|pull\\s+together|look\\s+(?:into|at|through|over)|go\\s+through|dig\\s+into|figure\\s+out|find\\s+out|" +
  "break\\s+down|walk\\s+(?:me\\s+)?through|mock\\s+up|write\\s+up|double[-\\s]?check|cross[-\\s]?reference|think\\s+(?:about|through)|" +
  "research|analy[sz]e|review|summari[sz]e|draft|outline|plan|prepare|brainstorm|compare|contrast|investigate|explore|examine|study|" +
  "organi[sz]e|categori[sz]e|classify|document|estimate|scope|map|identify|evaluate|assess|benchmark|" +
  "tell\\s+(?:me|us)|show\\s+(?:me|us)|explain|propose|recommend|suggest|sketch|list|track|monitor|audit|note|describe|recap|shortlist|weigh|consider|rank|arrange|give\\s+me|" +
  "collect|gather|calculate|compute|forecast|score|rate|measure|count|write|proofread|clarify|define|refine|read\\s+through|pull|check|tighten|highlight|compile|draw|fix|add|update|revise|rewrite|reword|expand|adjust|annotate|build|come\\s+up\\s+with|have\\s+a\\s+look|sanity\\s+check|work\\s+out|turn\\s+(?:\\w+\\s+){0,3}into|break\\s+(?:\\w+\\s+){0,3}into|" +
  "find|discover|search|see|determine|understand|quantify|diagnose|draw\\s+up|jot\\s+down|flesh\\s+out|" +
  // Qualifiers rather than actions — the shape a `constraints` entry takes.
  "order\\s+(?:\\w+\\s+){0,3}by\\s+(?!(?:friday|monday|tuesday|wednesday|thursday|saturday|sunday|today|tomorrow|tonight|next|the\\s+end|eod|noon)\\b)|book\\s+time|focus|keep|stay|avoid|prioriti[sz]e|limit|include|exclude|match|follow|stick|aim|ensure|maintain|preserve|mind|assume|treat|reuse";

const RESEARCH_OBJECT =
  "findings?|shortlists?|lists?|options?|results?|notes?|briefs?|decks?|slides?|outlines?|drafts?|documents?|docs?|" +
  "tables?|sections?|trackers?|timelines?|roadmaps?|summar(?:y|ies)|reports?|leads?|items?|rows?|columns?|" +
  "questions?|risks?|criteria|sprints?|plans?|breakdowns?|comparisons?|candidates?|entries|" +
  "numbers?|figures?|checklists?|diagrams?|agendas?|templates?|mockups?|wireframes?|taglines?|headlines?|copy|pages?";

/**
 * A second clearance path, for verbs that are ordinary document work when
 * their object is a document and ordinary danger when it is not: "archive the
 * old draft notes" against "archive the customer accounts", "clear up the open
 * questions" against "clear the production database".
 *
 * The object list is the load-bearing part and is deliberately all
 * document-ish nouns. A verb here clears ONLY with one of them, so a missing
 * noun costs an approval click and a missing verb costs nothing at all.
 *
 * It exists because the head-verb allowlist alone gated a third of a realistic
 * corpus of internal agency work, and a gate that fires on a third of ordinary
 * requests is how a founder learns to approve without reading — which is what
 * makes every real gate in this file worthless.
 */
/** Words that end a direct object. A document noun on the far side of one of these is not what the verb acts on. */
const OBJECT_BREAK = "in|into|onto|on|from|to|for|with|at|of|by|per|via|about|under|over|against|across";

const RESEARCH_WITH_OBJECT =
  `(?:sort|rank|group|arrange|place|drop|archive|merge|extend|reset|clear|trim|split|combine|put|make|draw|promote)` +
  `(?:\\s+(?:${VERB_PARTICLES}))?\\s+(?:(?!(?:${OBJECT_BREAK})\\b)\\w+\\s+){0,3}(?:${RESEARCH_OBJECT})\\b`;

const RESEARCH_HEAD_PATTERN = new RegExp(`^(?:(?:${RESEARCH_HEAD})\\b|${RESEARCH_WITH_OBJECT})`, "iu");

/**
 * Tokens that can never be a verb, used to tell a clause from a list
 * continuation ("Gojiberry for outreach tooling") or a noun-phrase field
 * ("Acme Foods"). Anything else at the head of a clause is treated as a verb —
 * which is the fail-closed direction, because an unknown verb then has to be
 * on the allowlist to clear.
 */
const NON_VERB_HEAD =
  /^(?:the|a|an|this|that|these|those|my|our|your|their|his|her|its|all|any|every|both|some|more|another|few|several|couple|no|not|for|with|about|from|into|onto|over|under|per|via|by|at|in|on|to|of|as|and|or|nor|but|if|when|while|once|because|since|though|although|it|they|he|she|we|you|there|here|which|who|what|where|why|how)\b/i;

/**
 * An instruction with the verb nominalized, so the clause opens with a
 * determiner and the head-verb test never sees it: "The records need
 * archiving", "The invoice has to be paid", "Get the deposit sent".
 *
 * These read as passive observations and act as commands. A clause in this
 * shape is examined rather than exempted, and clears only when the
 * nominalized verb is plainly research — the same allowlist direction as
 * everywhere else in this file.
 */
const NOMINALIZED_ACTION =
  /\b(?:needs?|has\s+to\s+be|have\s+to\s+be|should\s+be|must\s+be|ought\s+to\s+be|wants?)\s+(?:to\s+be\s+)?[\p{L}]{3,}(?:ing|ed)\b|\bget\s+(?:it|them|the\s+[\p{L}]+|[\p{L}]+)\s+[\p{L}]{3,}(?:ed|ing)\b/iu;

/**
 * A command with the verb as a bare trailing participle: "All the customer
 * accounts archived tonight", "Those old client accounts archived today".
 *
 * These open with a determiner, so the head test exempts them as noun phrases,
 * and they carry none of the `needs`/`has to be` markers above. The trailing
 * time expression is what distinguishes the imperative from an ordinary past
 * tense — "The records I reviewed yesterday" is a description; "the accounts
 * archived tonight" is an instruction.
 */
const PARTICIPLE_COMMAND =
  /\b[\p{L}]{3,}ed\b(?:\s+(?:today|tonight|tomorrow|now|immediately|asap|this\s+[\p{L}]+|next\s+[\p{L}]+|by\s+[\p{L}]+|before\s+[\p{L}]+|after\s+[\p{L}]+))?\s*$/iu;

const NOMINALIZED_RESEARCH =
  /\b(?:research|review|summar|draft|analy|writ|document|outlin|compar|investigat|organi[sz]|check|estimat|plan|scop|track|note|list|rank|sort|fix|rewrit|build|edit|tidy|tighten)\w*(?:ing|ed)\b/iu;

/**
 * A segment the clause rule must examine.
 *
 * `fromSentence` is the distinction that closes the two-word hole: a sentence
 * is never a list continuation, so "Draft the launch summary. Nuke staging."
 * gets its second sentence examined even though it is two words and "nuke" is
 * on no list. A segment split off at a COMMA or a conjunction can genuinely be
 * a continuation, so it is examined only when its head looks like a verb.
 */
function isInstructionClause(segment: string, fromSentence: boolean): boolean {
  const head = stripToHead(segment);
  if (!head) return false;
  const words = head.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  // A nominalized command opens with a determiner, so the head test would
  // exempt it. It is still a command.
  if (NOMINALIZED_ACTION.test(head)) return true;
  if (NON_VERB_HEAD.test(head)) return PARTICIPLE_COMMAND.test(head) && !NOMINALIZED_RESEARCH.test(head);
  if (fromSentence) return true;
  // A coordinator continuation is a clause only when it reads like one: a
  // recognized verb of any kind, or an unknown word followed by an object.
  return RESEARCH_HEAD_PATTERN.test(head) || OPENS_WITH_ACTION_VERB.test(head) || PREDICATE_SHAPE.test(head);
}

/** True when this clause may start work on its own. */
function isClearedClause(segment: string): boolean {
  const head = stripToHead(segment);
  if (NOMINALIZED_ACTION.test(head)) return NOMINALIZED_RESEARCH.test(head);
  return RESEARCH_HEAD_PATTERN.test(head);
}


/**
 * Classifies the full text a command was derived from. Callers pass every
 * field that carries founder intent (outcome, target, constraints, proposed
 * steps, open questions, requested integrations) concatenated — a gated verb
 * hiding in any of them must gate the command just as surely as one in the
 * headline outcome.
 */
export function assessCommandRisk(text: string): CommandRiskAssessment {
  return assessCommandRiskFields({ instructions: [text ?? ""], references: [] });
}

/**
 * The structured entry point, and the one `buildCommandDraft` uses.
 *
 * Not every captured field is an instruction. `requestedOutcome` and
 * `proposedSteps` are things the founder asked for, and the clause rule
 * applies to them. `target`, `constraints`, `missingInformation` and
 * `requiredIntegrations` are NOUN PHRASES and qualifiers — "KidsCoding",
 * "Stay under a week" — and asking them to prove they are research work gates
 * every ordinary draft. Under the previous single-string API they were
 * concatenated in with everything else, so a target of "KidsCoding" was read
 * as a clause whose head verb was "kidscoding".
 *
 * References are still fully scanned for categories, effect words, named
 * recipients and override attempts — an instruction hidden in an "open
 * question" is exactly the injection the classifier must see. They are simply
 * not required to look like research on their own.
 */
export function assessCommandRiskFields(input: { instructions: string[]; references: string[] }): CommandRiskAssessment {
  const instructionText = input.instructions.filter(Boolean).join(" \n ");
  const referenceText = input.references.filter(Boolean).join(" \n ");
  const subject = [instructionText, referenceText].filter(Boolean).join(" \n ").trim().slice(0, MAX_SUBJECT_LENGTH);
  if (!subject) {
    return {
      level: "medium",
      requiresApproval: true,
      gatedCategories: [],
      reasons: ["Jarvis could not tell what was being asked for, so it stopped for your decision."],
      overrideAttempted: false,
    };
  }

  // The clause rule applies to BOTH lists — it just applies differently.
  //
  // Exempting the reference fields entirely was a hole, and a large one: up to
  // 3600 characters of `constraints` plus a 200-character `target` were
  // governed by the categories alone, which is exactly the denylist design this
  // file's header records being defeated three times. A constraint reading
  // "Archive every account older than a year" cleared, and shipped to the
  // planner verbatim, while the identical string as an outcome gated.
  //
  // The difference that remains is only about SHAPE. An instruction field is
  // an instruction, so a whole sentence in one is a clause. A reference field
  // is usually a noun phrase or a qualifier — "KidsCoding", "Stay under a
  // week" — so a sentence in one is examined only when its head reads like a
  // verb, the same test a coordinator continuation gets.
  const segments = splitSegments(instructionText.slice(0, MAX_SUBJECT_LENGTH));
  const referenceSegments = splitSegments(referenceText.slice(0, MAX_SUBJECT_LENGTH)).map((segment) => ({
    ...segment,
    fromSentence: false,
  }));
  const allSegments = [...segments, ...referenceSegments];
  if (allSegments.length > MAX_SEGMENTS) {
    return {
      level: "medium",
      requiresApproval: true,
      gatedCategories: [],
      reasons: ["Jarvis could not follow this as one instruction, so it stopped for your decision"],
      overrideAttempted: OVERRIDE_ATTEMPT_PATTERN.test(subject),
    };
  }

  const gatedCategories: GatedCategory[] = [];
  let level: CommandRiskLevel = "low";
  const addCategory = (category: GatedCategory, ruleLevel: CommandRiskLevel) => {
    if (!gatedCategories.includes(category)) gatedCategories.push(category);
    level = maxLevel(level, ruleLevel);
  };

  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(subject)) addCategory(rule.category, rule.level);
  }
  // Checked per segment so a contact verb in one clause cannot be paired with a
  // recipient-shaped word in the next.
  if (allSegments.some((segment) => mentionsNamedRecipient(segment.text))) addCategory("customer_outreach", "high");

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
    const hardEffect = subject.match(HARD_EFFECT_PATTERN)?.[0];
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

    // THE clause rule. Every clause must have a head verb on the research
    // allowlist. Not "contains an internal word" — the head, and only the head:
    // INTERNAL_WORK_PATTERN necessarily contains nouns like `notes` and `plan`,
    // and one of those anywhere in the string used to vouch for the whole of it.
    const clauses = allSegments.filter((segment) => isInstructionClause(segment.text, segment.fromSentence));
    const uncleared = clauses.find((segment) => !isClearedClause(segment.text));
    if (uncleared) {
      const spoken = uncleared.text.replace(/\s+/g, " ").slice(0, 80);
      // Name the verb that stopped it. For a nominalized command ("the records
      // need archiving") the first word is a determiner, which would be a
      // useless thing to report.
      const stripped = stripToHead(uncleared.text);
      const nominalized = stripped.match(NOMINALIZED_ACTION)?.[0] ?? "";
      const head = (nominalized ? nominalized.split(/\s+/).pop() ?? "" : stripped.split(/\s+/)[0] ?? "").replace(/[^\p{L}'-]/gu, "");
      return {
        level: "medium",
        requiresApproval: true,
        gatedCategories: [],
        // Names the WORD, not just the clause. "could not tell that X is
        // internal work" was a checkable falsehood whenever X plainly
        // contained research language, and a gate that says something untrue
        // is how a founder learns to approve without reading.
        reasons: [
          head
            ? `Jarvis doesn't recognize "${head.toLowerCase()}" as research or writing work, so it stopped for your decision`
            : `Jarvis could not tell what "${spoken}" would do, so it stopped for your decision`,
        ],
        overrideAttempted: false,
      };
    }

    // At least one clause has to have actually asked for something. A subject
    // made only of noun phrases has not.
    if (clauses.length > 0) {
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
