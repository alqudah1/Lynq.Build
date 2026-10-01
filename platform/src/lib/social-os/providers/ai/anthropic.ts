import { SocialGenerationFailedError, SocialProviderNotConfiguredError } from "../../errors";
import { defaultFetch, estimateTokenCostUsd, extractJsonObject, jsonInstruction, present, requestJson, type ProviderDeps, type SocialAiEnv } from "./http";
import type { TextGenerationRequest, TextGenerationResult, TextProvider } from "./types";

/**
 * Module 19 — Anthropic Messages API text provider (direct HTTP, no SDK).
 * JSON mode: the Messages API has no response-format switch, so the schema
 * is appended as an instruction and the first JSON object in the reply is
 * parsed; an unparseable reply is a retryable failure.
 */

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_API_VERSION = "2023-06-01";
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";
const LABEL = "Anthropic";

/** Public list prices per million tokens (input/output). Used only for estimates. */
export const ANTHROPIC_PRICES = [
  { match: "sonnet-5-5", inputPerMTok: 2, outputPerMTok: 10 },
  { match: "opus-5-5", inputPerMTok: 4, outputPerMTok: 20 },
  { match: "haiku-4-5", inputPerMTok: 1, outputPerMTok: 5 },
] as const;

interface AnthropicResponse {
  model?: string;
  content?: { type?: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
}

export function createAnthropicProvider(env: SocialAiEnv, deps?: ProviderDeps): TextProvider {
  const fetchImpl = defaultFetch(deps);
  const defaultModel = env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;
  const missingConfiguration = () => (present(env.ANTHROPIC_API_KEY) ? [] : ["ANTHROPIC_API_KEY"]);
  return {
    id: "anthropic",
    kind: "text",
    label: LABEL,
    defaultModel,
    missingConfiguration,
    async generateText(request: TextGenerationRequest, options?: { model?: string; signal?: AbortSignal }): Promise<TextGenerationResult> {
      const missing = missingConfiguration();
      if (missing.length) throw new SocialProviderNotConfiguredError(LABEL, missing);
      const model = options?.model ?? defaultModel;
      const content = request.jsonSchema ? `${request.prompt}${jsonInstruction(request.jsonSchema)}` : request.prompt;
      const body: Record<string, unknown> = {
        model,
        max_tokens: request.maxOutputTokens ?? 4096,
        system: request.system,
        messages: [{ role: "user", content }],
      };
      if (request.temperature !== undefined) body.temperature = request.temperature;
      const raw = (await requestJson(fetchImpl, LABEL, ANTHROPIC_MESSAGES_URL, {
        method: "POST",
        headers: { "x-api-key": env.ANTHROPIC_API_KEY!.trim(), "anthropic-version": ANTHROPIC_API_VERSION, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: options?.signal,
      })) as AnthropicResponse;
      const text = (raw.content ?? [])
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text)
        .join("");
      const inputTokens = raw.usage?.input_tokens;
      const outputTokens = raw.usage?.output_tokens;
      const costUsd = estimateTokenCostUsd(ANTHROPIC_PRICES, model, inputTokens, outputTokens);
      const result: TextGenerationResult = { provider: "anthropic", model: raw.model ?? model, text, usage: { inputTokens, outputTokens, ...(costUsd !== undefined ? { costUsd, estimated: true } : {}) } };
      if (request.jsonSchema) {
        const json = extractJsonObject(text);
        if (json === undefined) throw new SocialGenerationFailedError(LABEL, "invalid JSON", true);
        result.json = json;
      }
      return result;
    },
  };
}
