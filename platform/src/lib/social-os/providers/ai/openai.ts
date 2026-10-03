import { SocialGenerationFailedError, SocialProviderNotConfiguredError } from "../../errors";
import { defaultFetch, extractJsonObject, present, requestJson, type ProviderDeps, type SocialAiEnv } from "./http";
import type { ImageGenerationRequest, ImageGenerationResult, ImageProvider, TextGenerationRequest, TextGenerationResult, TextProvider } from "./types";

/**
 * Module 19 — OpenAI text (Responses API) and image (Images API) providers,
 * direct HTTP.
 */

export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
export const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
export const DEFAULT_OPENAI_TEXT_MODEL = "gpt-5.3-mini";
export const DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-1.5";
const LABEL = "OpenAI";

function missing(env: SocialAiEnv): string[] {
  return present(env.OPENAI_API_KEY) ? [] : ["OPENAI_API_KEY"];
}

function authHeaders(env: SocialAiEnv): Record<string, string> {
  return { Authorization: `Bearer ${env.OPENAI_API_KEY!.trim()}`, "content-type": "application/json" };
}

interface ResponsesApiResponse {
  model?: string;
  output_text?: string;
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Text from a Responses API payload: every `output[].content[].text` of an output_text part, else the `output_text` convenience field. */
export function readResponsesText(raw: ResponsesApiResponse): string {
  const parts = (raw.output ?? []).flatMap((o) => o.content ?? []).filter((c) => (c.type === "output_text" || c.type === "text") && typeof c.text === "string");
  if (parts.length) return parts.map((c) => c.text).join("");
  return typeof raw.output_text === "string" ? raw.output_text : "";
}

export function createOpenAiTextProvider(env: SocialAiEnv, deps?: ProviderDeps): TextProvider {
  const fetchImpl = defaultFetch(deps);
  const defaultModel = env.OPENAI_TEXT_MODEL?.trim() || DEFAULT_OPENAI_TEXT_MODEL;
  return {
    id: "openai",
    kind: "text",
    label: LABEL,
    defaultModel,
    missingConfiguration: () => missing(env),
    async generateText(request: TextGenerationRequest, options?: { model?: string; signal?: AbortSignal }): Promise<TextGenerationResult> {
      const m = missing(env);
      if (m.length) throw new SocialProviderNotConfiguredError(LABEL, m);
      const model = options?.model ?? defaultModel;
      const body: Record<string, unknown> = {
        model,
        instructions: request.system,
        input: request.prompt,
        max_output_tokens: request.maxOutputTokens ?? 4096,
      };
      if (request.jsonSchema) body.text = { format: { type: "json_schema", name: "result", schema: request.jsonSchema, strict: false } };
      if (request.temperature !== undefined) body.temperature = request.temperature;
      const raw = (await requestJson(fetchImpl, LABEL, OPENAI_RESPONSES_URL, { method: "POST", headers: authHeaders(env), body: JSON.stringify(body), signal: options?.signal })) as ResponsesApiResponse;
      const text = readResponsesText(raw);
      // No reliable public price for every text model this deployment may route to — cost stays unknown rather than guessed.
      const result: TextGenerationResult = { provider: "openai", model: raw.model ?? model, text, usage: { inputTokens: raw.usage?.input_tokens, outputTokens: raw.usage?.output_tokens } };
      if (request.jsonSchema) {
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          json = extractJsonObject(text);
        }
        if (json === undefined || json === null || typeof json !== "object") throw new SocialGenerationFailedError(LABEL, "invalid JSON", true);
        result.json = json;
      }
      return result;
    },
  };
}

const IMAGE_SIZES: Record<ImageGenerationRequest["aspectRatio"], { size: string; width: number; height: number }> = {
  "1:1": { size: "1024x1024", width: 1024, height: 1024 },
  // The Images API offers one portrait size; 4:5 and 9:16 both map to it (closest supported).
  "4:5": { size: "1024x1536", width: 1024, height: 1536 },
  "9:16": { size: "1024x1536", width: 1024, height: 1536 },
  "16:9": { size: "1536x1024", width: 1536, height: 1024 },
  "3:2": { size: "1536x1024", width: 1536, height: 1024 },
};

/** Estimated medium-quality price per image (USD): ~$0.04 square, ~$0.06 for the larger portrait/landscape canvases. */
export function estimateOpenAiImageCostUsd(aspectRatio: ImageGenerationRequest["aspectRatio"]): number {
  return IMAGE_SIZES[aspectRatio].size === "1024x1024" ? 0.04 : 0.06;
}

export function createOpenAiImageProvider(env: SocialAiEnv, deps?: ProviderDeps & { outputFormat?: "png" | "jpeg" }): ImageProvider {
  const fetchImpl = defaultFetch(deps);
  const defaultModel = env.OPENAI_IMAGE_MODEL?.trim() || DEFAULT_OPENAI_IMAGE_MODEL;
  // JPEG by default: Instagram (the strictest target) only accepts JPEG, and every other platform accepts it too.
  const outputFormat = deps?.outputFormat ?? "jpeg";
  return {
    id: "openai",
    kind: "image",
    label: LABEL,
    defaultModel,
    missingConfiguration: () => missing(env),
    async generateImage(request: ImageGenerationRequest, options?: { model?: string; signal?: AbortSignal }): Promise<ImageGenerationResult> {
      const m = missing(env);
      if (m.length) throw new SocialProviderNotConfiguredError(LABEL, m);
      const model = options?.model ?? defaultModel;
      const size = IMAGE_SIZES[request.aspectRatio] ?? IMAGE_SIZES["1:1"];
      const prompt = request.style ? `${request.prompt}\n\nStyle: ${request.style}` : request.prompt;
      const raw = (await requestJson(fetchImpl, LABEL, OPENAI_IMAGES_URL, {
        method: "POST",
        headers: authHeaders(env),
        body: JSON.stringify({ model, prompt: prompt.slice(0, 32000), size: size.size, quality: "medium", output_format: outputFormat, n: 1 }),
        signal: options?.signal,
      })) as { data?: { b64_json?: string }[] };
      const b64 = raw.data?.[0]?.b64_json;
      if (!b64) throw new SocialGenerationFailedError(LABEL, "the provider returned no image", true);
      const bytes = new Uint8Array(Buffer.from(b64, "base64"));
      if (bytes.byteLength === 0) throw new SocialGenerationFailedError(LABEL, "the provider returned an empty image", true);
      return {
        provider: "openai",
        model,
        bytes,
        contentType: outputFormat === "png" ? "image/png" : "image/jpeg",
        width: size.width,
        height: size.height,
        usage: { units: 1, costUsd: estimateOpenAiImageCostUsd(request.aspectRatio), estimated: true },
      };
    },
  };
}
