import "server-only";
import { generateText, jsonSchema, Output } from "ai";
import { getOfficeGenerationConfig, getOfficeModel } from "@/lib/office/models";
import { SocialGenerationFailedError, SocialProviderNotConfiguredError } from "../../errors";
import { extractJsonObject, present, type SocialAiEnv } from "./http";
import type { TextGenerationRequest, TextGenerationResult, TextProvider } from "./types";

/**
 * Module 19 — the existing LYNQ Office model route (Vercel AI Gateway with
 * cross-model fallbacks, or Google AI Studio directly) as a TextProvider.
 * Same `generateText({ ...getOfficeGenerationConfig("planning"), … })`
 * call the Marketing OS Content Studio uses; JSON requests go through
 * `Output.object` with the caller's JSON Schema.
 */

const LABEL = "LYNQ Office model gateway";
const DEFAULT_GOOGLE_AI_STUDIO_MODEL = "gemini-2.5-flash-lite";

type GenerateTextFn = typeof generateText;

export function gatewayMissingConfiguration(env: SocialAiEnv): string[] {
  return present(env.OFFICE_PLANNING_MODEL) || present(env.GOOGLE_GENERATIVE_AI_API_KEY) ? [] : ["OFFICE_PLANNING_MODEL or GOOGLE_GENERATIVE_AI_API_KEY"];
}

function modelLabel(env: SocialAiEnv): string {
  if (present(env.GOOGLE_GENERATIVE_AI_API_KEY) && !present(env.OFFICE_PLANNING_MODEL)) return `google/${process.env.GOOGLE_AI_STUDIO_MODEL?.trim() || DEFAULT_GOOGLE_AI_STUDIO_MODEL}`;
  try {
    return env.OFFICE_PLANNING_MODEL?.trim() || getOfficeModel("planning");
  } catch {
    return "office-planning";
  }
}

export function createGatewayTextProvider(env: SocialAiEnv, deps?: { generateTextImpl?: GenerateTextFn }): TextProvider {
  const run = deps?.generateTextImpl ?? generateText;
  const defaultModel = modelLabel(env);
  return {
    id: "gateway",
    kind: "text",
    label: LABEL,
    defaultModel,
    missingConfiguration: () => gatewayMissingConfiguration(env),
    async generateText(request: TextGenerationRequest, options?: { model?: string; signal?: AbortSignal }): Promise<TextGenerationResult> {
      const missing = gatewayMissingConfiguration(env);
      if (missing.length) throw new SocialProviderNotConfiguredError(LABEL, missing);
      const config = getOfficeGenerationConfig("planning");
      try {
        if (request.jsonSchema) {
          const result = await run({
            ...config,
            system: request.system,
            prompt: request.prompt,
            maxOutputTokens: request.maxOutputTokens,
            temperature: request.temperature,
            abortSignal: options?.signal,
            output: Output.object({ name: "Result", schema: jsonSchema<Record<string, unknown>>(request.jsonSchema as Parameters<typeof jsonSchema>[0]) }),
          });
          const json = (result.output as unknown) ?? extractJsonObject(result.text);
          if (json === undefined || json === null) throw new SocialGenerationFailedError(LABEL, "invalid JSON", true);
          return { provider: "gateway", model: defaultModel, text: result.text || JSON.stringify(json), json, usage: { inputTokens: result.usage?.inputTokens, outputTokens: result.usage?.outputTokens } };
        }
        const result = await run({ ...config, system: request.system, prompt: request.prompt, maxOutputTokens: request.maxOutputTokens, temperature: request.temperature, abortSignal: options?.signal });
        return { provider: "gateway", model: defaultModel, text: result.text, usage: { inputTokens: result.usage?.inputTokens, outputTokens: result.usage?.outputTokens } };
      } catch (err) {
        if (err instanceof SocialGenerationFailedError || err instanceof SocialProviderNotConfiguredError) throw err;
        // AI SDK errors can embed the request; surface only the class name.
        const name = err instanceof Error ? err.name : "Error";
        throw new SocialGenerationFailedError(LABEL, `generation failed (${name})`, /NoObjectGenerated|NoOutput|RetryError|APICallError|Timeout/i.test(name));
      }
    },
  };
}
