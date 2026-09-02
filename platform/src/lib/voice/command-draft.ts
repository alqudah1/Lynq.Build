import { z } from "zod";
import { assessCommandRisk, type CommandRiskAssessment } from "./command-risk";
import { redactTranscriptText } from "./redaction";

/**
 * The structured command a phone conversation becomes.
 *
 * A call produces free-form speech; the Office needs a bounded, reviewable
 * instruction. This module defines that shape, builds it deterministically
 * from what the assistant captured, and formats the plain-language read-back
 * the founder confirms.
 *
 * Deliberately dependency-free (no database, no model, no environment): the
 * assistant supplies the fields through a tool call, this module validates,
 * normalizes, redacts, risk-assesses and formats them. Keeping the model out
 * of this file is what makes the safety classification deterministic — a
 * rate-limited or hallucinating model can degrade the QUALITY of the captured
 * fields, but it can never change whether a command is gated.
 */

const boundedString = (max: number) => z.string().trim().min(1).max(max);

/** Exactly the eight fields the lane brief requires a command draft to carry. */
export const commandDraftInputSchema = z
  .object({
    requestedOutcome: boundedString(2000),
    target: z.string().trim().max(200).optional().nullable(),
    constraints: z.array(boundedString(300)).max(12).optional(),
    requiredIntegrations: z.array(boundedString(80)).max(12).optional(),
    proposedSteps: z.array(boundedString(300)).max(12).optional(),
    missingInformation: z.array(boundedString(300)).max(12).optional(),
  })
  .strict();

export type CommandDraftInput = z.infer<typeof commandDraftInputSchema>;

export type ConfirmationStatus = "pending" | "confirmed" | "declined" | "expired";

export interface CommandDraft {
  requestedOutcome: string;
  /** The company or person the work is about, when the founder named one. Never guessed. */
  target: string | null;
  constraints: string[];
  requiredIntegrations: string[];
  proposedSteps: string[];
  missingInformation: string[];
  riskLevel: CommandRiskAssessment["level"];
  requiresApproval: boolean;
  gatedCategories: CommandRiskAssessment["gatedCategories"];
  riskReasons: string[];
  overrideAttempted: boolean;
  confirmationStatus: ConfirmationStatus;
  /** What Jarvis will read back on the call, and what the Office shows as "what Jarvis understood". */
  readback: string;
  /** True when a required field is missing — Jarvis must ask before it may accept a confirmation. */
  readyToConfirm: boolean;
}

/**
 * Integration names the Office actually has. An assistant that claims a
 * command needs something outside this list would be describing capability
 * the platform does not have, so unknown names are dropped into
 * `missingInformation` rather than silently promised.
 */
const KNOWN_INTEGRATIONS = new Set(["resend", "email", "vapi", "voice", "twilio", "github", "vercel", "crm", "brain", "office", "workflow", "analytics"]);

function normalizeList(values: string[] | undefined | null, limit: number): string[] {
  if (!values) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of values) {
    const value = redactTranscriptText(String(raw)).trim().replace(/\s+/g, " ");
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value.slice(0, 300));
    if (output.length >= limit) break;
  }
  return output;
}

/**
 * Builds the durable draft from what the assistant captured. Every string is
 * redacted on the way in, so a secret spoken into a "constraint" never
 * reaches the database.
 */
export function buildCommandDraft(input: CommandDraftInput): CommandDraft {
  const requestedOutcome = redactTranscriptText(input.requestedOutcome).replace(/\s+/g, " ").trim().slice(0, 2000);
  const target = input.target ? redactTranscriptText(input.target).replace(/\s+/g, " ").trim().slice(0, 200) || null : null;
  const constraints = normalizeList(input.constraints, 12);
  const proposedSteps = normalizeList(input.proposedSteps, 12);
  const missingInformation = normalizeList(input.missingInformation, 12);

  const requestedIntegrations = normalizeList(input.requiredIntegrations, 12);
  const requiredIntegrations = requestedIntegrations.filter((name) => KNOWN_INTEGRATIONS.has(name.toLowerCase()));
  const unknownIntegrations = requestedIntegrations.filter((name) => !KNOWN_INTEGRATIONS.has(name.toLowerCase()));

  const missing = [...missingInformation];
  for (const name of unknownIntegrations) {
    missing.push(`LYNQ is not connected to ${name} — confirm how this should be done instead.`);
  }
  if (!target && /\b(?:client|customer|prospect|restaurant|company|business|them|their)\b/i.test(requestedOutcome)) {
    missing.push("Which company or person this is for.");
  }

  // Every field that carries intent feeds the classifier — a gated verb in a
  // step or a constraint gates the command exactly like one in the outcome.
  const riskSubject = [requestedOutcome, target ?? "", ...constraints, ...proposedSteps].join(" \n ");
  const risk = assessCommandRisk(riskSubject);

  const draft: Omit<CommandDraft, "readback"> = {
    requestedOutcome,
    target,
    constraints,
    requiredIntegrations,
    proposedSteps,
    missingInformation: normalizeList(missing, 12),
    riskLevel: risk.level,
    requiresApproval: risk.requiresApproval,
    gatedCategories: risk.gatedCategories,
    riskReasons: risk.reasons,
    overrideAttempted: risk.overrideAttempted,
    confirmationStatus: "pending",
    readyToConfirm: requestedOutcome.length >= 10,
  };

  return { ...draft, readback: formatCommandReadback(draft) };
}

/**
 * The plain-language read-back. Written to be SPOKEN: short sentences, no
 * jargon, no identifiers, and an explicit statement of what will and will not
 * happen. It always ends with a yes/no question, because the founder's answer
 * to that question is the only thing that moves a draft to confirmed.
 */
export function formatCommandReadback(draft: Omit<CommandDraft, "readback">): string {
  const lines: string[] = [];

  lines.push(`Here's what I understood. You want me to ${lowerFirst(draft.requestedOutcome)}.`);
  if (draft.target) lines.push(`This is for ${draft.target}.`);

  if (draft.constraints.length > 0) {
    lines.push(`Your conditions: ${joinSpoken(draft.constraints)}.`);
  }
  if (draft.proposedSteps.length > 0) {
    lines.push(`My plan is to ${joinSpoken(draft.proposedSteps.map(lowerFirst))}.`);
  }
  if (draft.missingInformation.length > 0) {
    lines.push(`I still need to know ${joinSpoken(draft.missingInformation.map(lowerFirst))}.`);
  }

  if (draft.requiresApproval) {
    const reason = draft.riskReasons[0];
    lines.push(
      reason
        ? `I can't start this from a phone call, because it involves ${lowerFirst(reason)}. I'll put it in LYNQ Office for you to approve there, and nothing happens until you do.`
        : "I can't start this from a phone call. I'll put it in LYNQ Office for you to approve there, and nothing happens until you do."
    );
  } else {
    lines.push("This is internal work, so once you confirm I'll open the project and brief the team.");
  }

  lines.push("Did I get that right?");
  return lines.join(" ");
}

function lowerFirst(value: string): string {
  if (!value) return value;
  // Leave acronyms and proper nouns alone — only lower a plain leading capital.
  if (/^[A-Z][a-z]/.test(value)) return value[0].toLowerCase() + value.slice(1);
  return value;
}

function joinSpoken(values: string[]): string {
  const cleaned = values.map((value) => value.replace(/\.$/, ""));
  if (cleaned.length === 0) return "";
  if (cleaned.length === 1) return cleaned[0];
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(", ")}, and ${cleaned[cleaned.length - 1]}`;
}

/** Exactly the founder-authored fields the Office planner needs — no risk metadata, which is decided elsewhere and never re-derived from this string. */
export type DirectiveInstructionSource = Pick<CommandDraft, "requestedOutcome" | "target" | "constraints" | "proposedSteps" | "missingInformation">;

/**
 * The single instruction string handed to the existing Office directive
 * planner. Everything the founder actually said that shapes the work is
 * folded in, so the Office plan is built from the same facts the founder
 * confirmed — not from a lossy headline.
 */
export function toDirectiveInstruction(draft: DirectiveInstructionSource): string {
  const parts: string[] = [draft.requestedOutcome];
  if (draft.target) parts.push(`This is for ${draft.target}.`);
  if (draft.constraints.length > 0) parts.push(`Constraints: ${draft.constraints.join("; ")}.`);
  if (draft.proposedSteps.length > 0) parts.push(`Proposed steps: ${draft.proposedSteps.join("; ")}.`);
  if (draft.missingInformation.length > 0) {
    parts.push(`Open questions the founder has not answered yet: ${draft.missingInformation.join("; ")}. Ask before assuming any of these.`);
  }
  parts.push("Captured from a verified founder phone call. Do not contact anyone outside LYNQ, spend money, or change production without a separate approval.");
  // The Office directive schema caps an instruction at 5000 characters.
  return parts.join(" ").slice(0, 5000);
}
