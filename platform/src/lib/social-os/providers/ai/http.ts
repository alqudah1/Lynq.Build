import { SocialGenerationFailedError } from "../../errors";
import type { FetchLike } from "./types";

/**
 * Module 19 — shared plumbing for the creative AI provider modules: the
 * env slice they read, a JSON request helper that classifies failures the
 * way the runtime queue needs (`retryable` → transient), and JSON
 * extraction for providers without native structured output.
 *
 * Provider error bodies can echo request details, so failures carry only
 * the HTTP status and the provider's short error type/message — never the
 * request, the response body or a credential.
 */

/** The environment keys the AI provider layer reads (a structural slice of `Env` so tests can pass a plain object). */
export interface SocialAiEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_TEXT_MODEL?: string;
  OPENAI_IMAGE_MODEL?: string;
  RUNWAYML_API_SECRET?: string;
  RUNWAYML_VIDEO_MODEL?: string;
  HIGGSFIELD_API_KEY?: string;
  HIGGSFIELD_API_SECRET?: string;
  OFFICE_PLANNING_MODEL?: string;
  /** Not declared in `loadEnv()` (the Office model router reads it from `process.env` directly); passed through by `loadSocialAiEnv`. */
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
  SOCIAL_AI_DAILY_BUDGET_USD?: number;
}

export interface ProviderDeps {
  fetchImpl?: FetchLike;
}

export function defaultFetch(deps?: ProviderDeps): FetchLike {
  return deps?.fetchImpl ?? ((input, init) => fetch(input, init));
}

export function present(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** HTTP status → retryable? 408/409/425/429/5xx (incl. Anthropic's 529 "overloaded") are transient; auth and validation failures are not. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function shortProviderMessage(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const err = (body as Record<string, unknown>).error;
  if (typeof err === "string") return err.slice(0, 160);
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    const parts = [typeof e.type === "string" ? e.type : typeof e.code === "string" ? e.code : "", typeof e.message === "string" ? e.message.slice(0, 160) : ""].filter(Boolean);
    return parts.join(": ");
  }
  const detail = (body as Record<string, unknown>).detail ?? (body as Record<string, unknown>).message;
  return typeof detail === "string" ? detail.slice(0, 160) : "";
}

/** Sends a request and returns parsed JSON, throwing `SocialGenerationFailedError` with a bounded message on any failure. */
export async function requestJson(fetchImpl: FetchLike, providerLabel: string, url: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new SocialGenerationFailedError(providerLabel, "the request was aborted", false);
    throw new SocialGenerationFailedError(providerLabel, "network error reaching the provider", true);
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    const detail = shortProviderMessage(body);
    const what = res.status === 401 || res.status === 403 ? "authentication failed — check the API key" : `request failed`;
    throw new SocialGenerationFailedError(providerLabel, `${what} (${res.status})${detail ? `: ${detail}` : ""}`, isRetryableStatus(res.status));
  }
  if (body === null) throw new SocialGenerationFailedError(providerLabel, "the provider returned an unreadable response", true);
  return body;
}

/** Downloads a binary with a size ceiling (checked against content-length first, then while reading). */
export async function downloadBytes(fetchImpl: FetchLike, providerLabel: string, url: string, maxBytes: number): Promise<{ bytes: Uint8Array; contentType: string }> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "GET", redirect: "follow" });
  } catch {
    throw new SocialGenerationFailedError(providerLabel, "network error downloading the output", true);
  }
  if (!res.ok) throw new SocialGenerationFailedError(providerLabel, `output download failed (${res.status})`, isRetryableStatus(res.status));
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new SocialGenerationFailedError(providerLabel, `the output is larger than ${Math.round(maxBytes / 1024 / 1024)}MB`, false);
  const buffer = new Uint8Array(await res.arrayBuffer());
  if (buffer.byteLength === 0) throw new SocialGenerationFailedError(providerLabel, "the output file is empty", false);
  if (buffer.byteLength > maxBytes) throw new SocialGenerationFailedError(providerLabel, `the output is larger than ${Math.round(maxBytes / 1024 / 1024)}MB`, false);
  const contentType = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
  return { bytes: buffer, contentType };
}

/**
 * Extracts the first balanced JSON object from model text: strips ```
 * fences, then scans from the first `{` honouring strings and escapes.
 * Returns `undefined` when there is no parseable object.
 */
export function extractJsonObject(text: string): unknown {
  const unfenced = text.replace(/```(?:json|JSON)?\s*([\s\S]*?)```/g, "$1");
  for (const candidate of [unfenced, text]) {
    let start = candidate.indexOf("{");
    while (start !== -1) {
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = start; i < candidate.length; i++) {
        const ch = candidate[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === "\\") escaped = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') inString = true;
        else if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(candidate.slice(start, i + 1));
            } catch {
              break;
            }
          }
        }
      }
      start = candidate.indexOf("{", start + 1);
    }
  }
  return undefined;
}

/** The instruction appended to a prompt when a provider has no native JSON mode. */
export function jsonInstruction(schema: Record<string, unknown>): string {
  return `\n\nAnswer with ONLY a single JSON object (no prose, no markdown fences) that matches this JSON Schema:\n${JSON.stringify(schema)}`;
}

/** Per-million-token prices (USD) keyed by a model-name fragment (`sonnet-5-5` matches `claude-sonnet-5-5-20260101`). Estimates only; flagged `estimated`. */
export function estimateTokenCostUsd(table: readonly { match: string; inputPerMTok: number; outputPerMTok: number }[], model: string, inputTokens?: number, outputTokens?: number): number | undefined {
  const entry = table.find((t) => model.includes(t.match));
  if (!entry || inputTokens === undefined || outputTokens === undefined) return undefined;
  const cost = (inputTokens * entry.inputPerMTok + outputTokens * entry.outputPerMTok) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
