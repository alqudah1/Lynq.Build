import "server-only";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { gateway, type LanguageModel } from "ai";

export type OfficeModelRole = "planning" | "engineering" | "review";

const DEFAULT_MODEL = "inclusionai/ling-3.0-flash-fin-free";
const DEFAULT_FALLBACK_MODELS = ["minimax/minimax-m2.7-free", "poolside/laguna-s-2.1-free"];
const DEFAULT_GOOGLE_AI_STUDIO_MODEL = "gemini-2.5-flash-lite";
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
 * changing application code. The default chain uses current zero-cost Gateway
 * models with tool support; production can route roles to paid models later.
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
  model: LanguageModel;
  providerOptions?: { gateway: { models: string[]; tags: string[] } };
} {
  const googleApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  const explicitRoleModel = process.env[ENV_BY_ROLE[role]]?.trim();
  // A direct Google key is the zero-cost default transport, but it must not
  // silently replace an explicit role policy. This lets production use a
  // premium planner/reviewer while retaining Google AI Studio as an optional
  // budget-friendly default for roles that have not been deliberately routed.
  if (googleApiKey && !explicitRoleModel) {
    const google = createGoogleGenerativeAI({ apiKey: googleApiKey });
    return { model: google(process.env.GOOGLE_AI_STUDIO_MODEL?.trim() || DEFAULT_GOOGLE_AI_STUDIO_MODEL) };
  }

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

export function isDirectGoogleModelConfigured(): boolean {
  return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim());
}
