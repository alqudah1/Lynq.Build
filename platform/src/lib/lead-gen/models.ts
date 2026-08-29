import "server-only";

/**
 * ============================================================================
 * Lead-gen model routing — Claude, through the existing gateway
 * ============================================================================
 * Deliberately the same shape as `lib/office/models.ts`: a fixed set of
 * ROLES, each resolved from its own environment variable, each validated
 * to the AI Gateway's `provider/model` form. No credential is read here,
 * none is compiled in, and nothing in this file is importable from the
 * browser (`server-only`). The gateway credential lives only in the Vercel
 * environment; changing which Claude model a role uses is an env change,
 * never a deploy.
 *
 * Why roles rather than one model: reply classification runs on every
 * inbound message and wants a small fast model, while reviewing whether a
 * demo is fit to put in front of a real business is the one place worth
 * spending the most capable model available. Splitting them is what makes
 * both affordable.
 */

export type LeadGenModelRole = "research" | "content" | "review" | "classification";

const ENV_BY_ROLE: Record<LeadGenModelRole, string> = {
  research: "LEADGEN_RESEARCH_MODEL",
  content: "LEADGEN_CONTENT_MODEL",
  review: "LEADGEN_REVIEW_MODEL",
  classification: "LEADGEN_CLASSIFICATION_MODEL",
};

/**
 * Claude by default, in gateway `provider/model` form. These are defaults,
 * not pins: set the matching env var to move a role to a different model
 * without touching code.
 */
const DEFAULT_MODEL_BY_ROLE: Record<LeadGenModelRole, string> = {
  // Prospect research, qualification, digital pain points.
  research: "anthropic/claude-sonnet-5",
  // Demo style selection, business-specific website content, outreach drafts.
  content: "anthropic/claude-sonnet-5",
  // Demo quality review before outreach — the highest-stakes judgement here,
  // because its output is what lets a message reach a real business.
  review: "anthropic/claude-opus-5",
  // Reply classification and follow-up triage: high volume, small decisions.
  classification: "anthropic/claude-haiku-4.5",
};

const PROVIDER_MODEL_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i;

export function getLeadGenModel(role: LeadGenModelRole): string {
  const value = process.env[ENV_BY_ROLE[role]]?.trim() || DEFAULT_MODEL_BY_ROLE[role];
  if (!PROVIDER_MODEL_PATTERN.test(value)) {
    throw new Error(`${ENV_BY_ROLE[role]} must use provider/model format`);
  }
  return value;
}

/** Every role's resolved model — for a settings screen or a deployment report, never for logging a request. */
export function describeLeadGenModelRouting(): Array<{ role: LeadGenModelRole; envVar: string; model: string; isDefault: boolean }> {
  return (Object.keys(ENV_BY_ROLE) as LeadGenModelRole[]).map((role) => {
    const configured = process.env[ENV_BY_ROLE[role]]?.trim();
    return { role, envVar: ENV_BY_ROLE[role], model: getLeadGenModel(role), isDefault: !configured };
  });
}
