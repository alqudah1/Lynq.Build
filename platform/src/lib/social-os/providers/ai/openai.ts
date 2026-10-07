import { SocialGenerationFailedError, SocialProviderNotConfiguredError } from "../../errors";
import { defaultFetch, extractJsonObject, present, requestJson, type ProviderDeps, type SocialAiEnv } from "./http";
import type { FetchLike, ImageGenerationRequest, ImageGenerationResult, ImageProvider, TextGenerationRequest, TextGenerationResult, TextProvider } from "./types";

/**
 * Module 19 — OpenAI text (Responses API) and image (Images API) providers,
 * direct HTTP.
 */

export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
export const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
/** Image edits: same models, conditioned on input images (used to keep a brand mascot/logo consistent). */
export const OPENAI_IMAGE_EDITS_URL = "https://api.openai.com/v1/images/edits";
export const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
/**
 * Model ids differ per account (new families roll out gradually and old
 * ones retire), so a hard-coded default is a guess that fails with a 404.
 * When no `OPENAI_TEXT_MODEL` / `OPENAI_IMAGE_MODEL` is configured, the
 * provider lists the account's models once and picks the first of these
 * that the account actually has. The first entry is only the fallback
 * when the listing itself is unavailable.
 */
export const OPENAI_TEXT_MODEL_PREFERENCE = ["gpt-6-luna", "gpt-6.1-sol", "gpt-5.3-mini", "gpt-5-mini", "gpt-5.1-mini", "gpt-5", "gpt-4.1-mini", "gpt-4o-mini"] as const;
export const OPENAI_IMAGE_MODEL_PREFERENCE = ["gpt-image-2.5-flare", "gpt-image-1.5", "gpt-image-1", "gpt-image-2.5-sunburst"] as const;
export const DEFAULT_OPENAI_TEXT_MODEL = OPENAI_TEXT_MODEL_PREFERENCE[0];
export const DEFAULT_OPENAI_IMAGE_MODEL = OPENAI_IMAGE_MODEL_PREFERENCE[0];
const LABEL = "OpenAI";
const MODEL_LIST_TTL_MS = 10 * 60 * 1000;

/** Picks the first preferred model the account lists; `undefined` when nothing in the list is available. */
export function pickAvailableModel(available: Iterable<string>, preference: readonly string[]): string | undefined {
  const set = new Set(available);
  return preference.find((m) => set.has(m));
}

function createModelResolver(env: SocialAiEnv, fetchImpl: FetchLike, preference: readonly string[], configured: string | undefined) {
  let cache: { at: number; models: Set<string> } | null = null;
  return async function resolve(): Promise<string> {
    if (configured) return configured;
    if (!cache || Date.now() - cache.at > MODEL_LIST_TTL_MS) {
      try {
        const raw = (await requestJson(fetchImpl, LABEL, OPENAI_MODELS_URL, { method: "GET", headers: authHeaders(env) })) as { data?: { id?: string }[] };
        cache = { at: Date.now(), models: new Set((raw.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string")) };
      } catch {
        return preference[0];
      }
    }
    return pickAvailableModel(cache.models, preference) ?? preference[0];
  };
}

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
  const configured = env.OPENAI_TEXT_MODEL?.trim() || undefined;
  const defaultModel = configured ?? DEFAULT_OPENAI_TEXT_MODEL;
  const resolveModel = createModelResolver(env, fetchImpl, OPENAI_TEXT_MODEL_PREFERENCE, configured);
  return {
    id: "openai",
    kind: "text",
    label: LABEL,
    defaultModel,
    missingConfiguration: () => missing(env),
    async generateText(request: TextGenerationRequest, options?: { model?: string; signal?: AbortSignal }): Promise<TextGenerationResult> {
      const m = missing(env);
      if (m.length) throw new SocialProviderNotConfiguredError(LABEL, m);
      const model = options?.model ?? (await resolveModel());
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

/** Centre-crops to `ratio` (width / height). Falls back to the original bytes if the image library is unavailable. */
async function centreCrop(bytes: Uint8Array<ArrayBuffer>, width: number, height: number, ratio: number, format: "png" | "jpeg"): Promise<{ bytes: Uint8Array<ArrayBuffer>; width: number; height: number }> {
  const targetHeight = Math.round(width / ratio);
  if (targetHeight >= height) return { bytes, width, height };
  try {
    const sharp = (await import("sharp")).default;
    const top = Math.round((height - targetHeight) / 2);
    const out = await sharp(Buffer.from(bytes)).extract({ left: 0, top, width, height: targetHeight }).toFormat(format).toBuffer();
    return { bytes: new Uint8Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer), width, height: targetHeight };
  } catch {
    return { bytes, width, height };
  }
}

export function estimateOpenAiImageCostUsd(aspectRatio: ImageGenerationRequest["aspectRatio"]): number {
  return IMAGE_SIZES[aspectRatio].size === "1024x1024" ? 0.04 : 0.06;
}

export function createOpenAiImageProvider(env: SocialAiEnv, deps?: ProviderDeps & { outputFormat?: "png" | "jpeg" }): ImageProvider {
  const fetchImpl = defaultFetch(deps);
  const configured = env.OPENAI_IMAGE_MODEL?.trim() || undefined;
  const defaultModel = configured ?? DEFAULT_OPENAI_IMAGE_MODEL;
  const resolveModel = createModelResolver(env, fetchImpl, OPENAI_IMAGE_MODEL_PREFERENCE, configured);
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
      const model = options?.model ?? (await resolveModel());
      const size = IMAGE_SIZES[request.aspectRatio] ?? IMAGE_SIZES["1:1"];
      const prompt = request.style ? `${request.prompt}\n\nStyle: ${request.style}` : request.prompt;
      const refs = (request.references ?? []).filter((r) => /^image\/(png|jpeg|webp)$/.test(r.contentType)).slice(0, 4);
      const generate = async () =>
        (await requestJson(fetchImpl, LABEL, OPENAI_IMAGES_URL, {
          method: "POST",
          headers: authHeaders(env),
          body: JSON.stringify({ model, prompt: prompt.slice(0, 32000), size: size.size, quality: "medium", output_format: outputFormat, n: 1 }),
          signal: options?.signal,
        })) as { data?: { b64_json?: string }[] };
      let raw: { data?: { b64_json?: string }[] };
      if (refs.length) {
        // Reference images (the brand's mascot / logo) go to the edits endpoint so the character stays the same across posts.
        const form = new FormData();
        form.append("model", model);
        form.append("prompt", `${prompt}\n\nThe attached reference image(s) show the brand's own mascot/logo. Keep that character exactly the same — shape, colours, face, outfit, proportions — and place it in the new scene described above. Do not copy the reference's background or text.`.slice(0, 32000));
        form.append("size", size.size);
        form.append("quality", "medium");
        form.append("output_format", outputFormat);
        form.append("n", "1");
        refs.forEach((r, i) => form.append("image[]", new Blob([Buffer.from(r.bytes)], { type: r.contentType }), `${r.tag || "reference"}-${i}.${r.contentType.split("/")[1]}`));
        try {
          raw = (await requestJson(fetchImpl, LABEL, OPENAI_IMAGE_EDITS_URL, { method: "POST", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY!.trim()}` }, body: form, signal: options?.signal })) as { data?: { b64_json?: string }[] };
        } catch (err) {
          // A model or account without edits access still gets an image — just without the reference.
          if (err instanceof SocialGenerationFailedError && !err.message.includes("authentication")) raw = await generate();
          else throw err;
        }
      } else {
        raw = await generate();
      }
      const b64 = raw.data?.[0]?.b64_json;
      if (!b64) throw new SocialGenerationFailedError(LABEL, "the provider returned no image", true);
      let bytes: Uint8Array<ArrayBuffer> = new Uint8Array(Buffer.from(b64, "base64"));
      if (bytes.byteLength === 0) throw new SocialGenerationFailedError(LABEL, "the provider returned an empty image", true);
      // OpenAI only renders 1:1, 2:3 and 3:2. A 4:5 request (Instagram feed) is rendered at 2:3 and centre-cropped here,
      // otherwise Instagram crops it itself and cuts the top and bottom of the design.
      let { width, height } = size;
      if (request.aspectRatio === "4:5") {
        const cropped = await centreCrop(bytes, size.width, size.height, 4 / 5, outputFormat);
        bytes = cropped.bytes;
        width = cropped.width;
        height = cropped.height;
      }
      return {
        provider: "openai",
        model,
        bytes,
        contentType: outputFormat === "png" ? "image/png" : "image/jpeg",
        width,
        height,
        usage: { units: 1, costUsd: estimateOpenAiImageCostUsd(request.aspectRatio), estimated: true },
      };
    },
  };
}
