import "server-only";

export type OfficeModelRole = "planning" | "engineering" | "review";

const DEFAULT_MODEL = "openai/gpt-5.4-mini";
const ENV_BY_ROLE: Record<OfficeModelRole, string> = {
  planning: "OFFICE_PLANNING_MODEL",
  engineering: "OFFICE_ENGINEERING_MODEL",
  review: "OFFICE_REVIEW_MODEL",
};

/**
 * Role-level routing lets the Office use independent providers without
 * changing application code. Keep the free-tier OpenAI model as the safe
 * default; production can route Planning/Review to Claude after Gateway or
 * Anthropic API billing is enabled.
 */
export function getOfficeModel(role: OfficeModelRole): string {
  const value = process.env[ENV_BY_ROLE[role]]?.trim() || DEFAULT_MODEL;
  if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(value)) {
    throw new Error(`${ENV_BY_ROLE[role]} must use provider/model format`);
  }
  return value;
}
