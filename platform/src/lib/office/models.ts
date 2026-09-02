import "server-only";

import { gateway } from "ai";

export type OfficeModelRole = "planning" | "engineering" | "review";

const DEFAULT_MODEL = "openai/gpt-5.4-mini";
const DEFAULT_FALLBACK_MODELS = ["openai/gpt-5-nano", "alibaba/qwen3.5-flash", "google/gemini-3-flash"];
const ENV_BY_ROLE: Record<OfficeModelRole, string> = {
  planning: "OFFICE_PLANNING_MODEL",
  engineering: "OFFICE_ENGINEERING_MODEL",
  review: "OFFICE_REVIEW_MODEL",
};

function validateModel(value: string, envName: string): string {
  if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(value)) {
    throw new Error(`${envName} must use provider/model format`);
  }
  return value;
}

/**
 * Role-level routing lets the Office use independent providers without
 * changing application code. Keep the free-tier OpenAI model as the safe
 * default; production can route Planning/Review to Claude after Gateway or
 * Anthropic API billing is enabled.
 */
export function getOfficeModel(role: OfficeModelRole): string {
  const value = process.env[ENV_BY_ROLE[role]]?.trim() || DEFAULT_MODEL;
  return validateModel(value, ENV_BY_ROLE[role]);
}

/**
 * Gateway-side model fallbacks keep one busy provider from stopping an entire
 * Office handoff. The primary remains role-configurable, while the default
 * fallbacks deliberately span providers and favor inexpensive models.
 */
export function getOfficeGenerationConfig(role: OfficeModelRole): {
  model: ReturnType<typeof gateway>;
  providerOptions: { gateway: { models: string[]; tags: string[] } };
} {
  const model = getOfficeModel(role);
  const fallbackEnvName = `${ENV_BY_ROLE[role]}_FALLBACKS`;
  const configuredFallbacks = process.env[fallbackEnvName]
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const models = [...new Set((configuredFallbacks?.length ? configuredFallbacks : DEFAULT_FALLBACK_MODELS)
    .map((value) => validateModel(value, fallbackEnvName))
    .filter((value) => value !== model))];
  return {
    // The explicit Gateway model wrapper is required for Gateway routing
    // options such as cross-model fallbacks to be applied by the AI SDK.
    model: gateway(model),
    providerOptions: {
      gateway: {
        models,
        tags: ["feature:lynq-office", `role:${role}`],
      },
    },
  };
}
