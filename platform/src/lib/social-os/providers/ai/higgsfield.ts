import { SocialGenerationFailedError, SocialProviderNotConfiguredError, SocialProviderNotSupportedError } from "../../errors";
import { defaultFetch, downloadBytes, present, requestJson, type ProviderDeps, type SocialAiEnv } from "./http";
import type { VideoGenerationRequest, VideoProvider, VideoTaskStatus } from "./types";

/**
 * Module 19 — Higgsfield video provider (queue API: submit → request id →
 * status polling). Image conditioning needs a public image URL; we never
 * expose asset bytes to a third party implicitly, so a `promptImage` without
 * an explicit `imageUrl` option is refused.
 */

export const HIGGSFIELD_API_BASE = "https://api.higgsfield.ai";
/**
 * Model ids verified against the published API reference (2026-10):
 * `POST https://api.higgsfield.ai/bytedance/seedance-2.5/text-to-video`
 * (`prompt`, `duration` 4–30, `resolution` 480p|720p|1080p, `aspect_ratio`
 * 16:9|4:3|1:1|3:4|9:16|21:9) and `.../image-to-video` (`image_url`
 * required, `prompt`, `duration`, `resolution`; no `aspect_ratio` — the
 * source image sets it). Polling: `GET /requests/{id}/status` with
 * statuses queued | in_progress | completed | failed | nsfw | canceled.
 */
export const DEFAULT_HIGGSFIELD_VIDEO_MODEL = "bytedance/seedance-2.5/text-to-video";
export const DEFAULT_HIGGSFIELD_IMAGE_TO_VIDEO_MODEL = "bytedance/seedance-2.5/image-to-video";
const LABEL = "Higgsfield";
const DEFAULT_MAX_VIDEO_BYTES = 200 * 1024 * 1024;

function missing(env: SocialAiEnv): string[] {
  const out: string[] = [];
  if (!present(env.HIGGSFIELD_API_KEY)) out.push("HIGGSFIELD_API_KEY");
  if (!present(env.HIGGSFIELD_API_SECRET)) out.push("HIGGSFIELD_API_SECRET");
  return out;
}

function headers(env: SocialAiEnv, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Key ${env.HIGGSFIELD_API_KEY!.trim()}:${env.HIGGSFIELD_API_SECRET!.trim()}`, "Content-Type": "application/json", Accept: "application/json", ...extra };
}

function requireConfigured(env: SocialAiEnv): void {
  const m = missing(env);
  if (m.length) throw new SocialProviderNotConfiguredError(LABEL, m);
}

interface HiggsfieldStatus {
  status?: string;
  request_id?: string;
  video?: { url?: string };
  error?: string;
}

export function mapHiggsfieldStatus(raw: HiggsfieldStatus): VideoTaskStatus {
  switch (raw.status) {
    case "queued":
      return { status: "pending" };
    case "in_progress":
      return { status: "running" };
    case "completed":
      return raw.video?.url ? { status: "succeeded", outputUrl: raw.video.url } : { status: "failed", failureCode: "no_output", failureMessage: "Higgsfield completed without a video" };
    case "nsfw":
      return { status: "failed", failureCode: "nsfw", failureMessage: "The request was rejected by the provider's content filter" };
    case "failed":
      return { status: "failed", failureCode: "failed", failureMessage: (typeof raw.error === "string" ? raw.error : "Higgsfield reported a failure").slice(0, 300) };
    case "canceled":
    case "cancelled":
      return { status: "cancelled" };
    default:
      return { status: "pending" };
  }
}

export function createHiggsfieldVideoProvider(env: SocialAiEnv, deps?: ProviderDeps): VideoProvider {
  const fetchImpl = defaultFetch(deps);
  return {
    id: "higgsfield",
    kind: "video",
    label: LABEL,
    defaultModel: DEFAULT_HIGGSFIELD_VIDEO_MODEL,
    missingConfiguration: () => missing(env),
    // No published per-second price we can rely on — the budget guard treats it as unknown.
    estimatedCostPerSecondUsd: () => null,
    async startVideo(request: VideoGenerationRequest, options?: { model?: string; imageUrl?: string }) {
      requireConfigured(env);
      if (request.promptImage && !options?.imageUrl) throw new SocialProviderNotSupportedError(LABEL, "image-conditioned video without a public image URL");
      const model = (options?.model ?? (options?.imageUrl ? DEFAULT_HIGGSFIELD_IMAGE_TO_VIDEO_MODEL : DEFAULT_HIGGSFIELD_VIDEO_MODEL)).replace(/^\/+/, "");
      if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(model)) throw new SocialGenerationFailedError(LABEL, "invalid model path", false);
      const body: Record<string, unknown> = { prompt: request.prompt.slice(0, 2000), duration: request.durationSeconds, resolution: "1080p" };
      // Image-to-video takes its aspect ratio from the source image; the API rejects unknown fields conservatively, so only send it for text-to-video.
      if (options?.imageUrl) body.image_url = options.imageUrl;
      else body.aspect_ratio = request.aspectRatio;
      const created = (await requestJson(fetchImpl, LABEL, `${HIGGSFIELD_API_BASE}/${model}`, {
        method: "POST",
        headers: headers(env, request.idempotencyKey ? { "Idempotency-Key": request.idempotencyKey } : {}),
        body: JSON.stringify(body),
      })) as { request_id?: string; status_url?: string };
      if (!created.request_id) throw new SocialGenerationFailedError(LABEL, "the provider returned no request id", true);
      return { taskId: created.request_id, model };
    },
    async pollVideo(taskId: string) {
      requireConfigured(env);
      const raw = (await requestJson(fetchImpl, LABEL, `${HIGGSFIELD_API_BASE}/requests/${encodeURIComponent(taskId)}/status`, { method: "GET", headers: headers(env) })) as HiggsfieldStatus;
      return mapHiggsfieldStatus(raw);
    },
    async downloadVideo(outputUrl: string, options?: { maxBytes?: number }) {
      const out = await downloadBytes(fetchImpl, LABEL, outputUrl, options?.maxBytes ?? DEFAULT_MAX_VIDEO_BYTES);
      return { bytes: out.bytes, contentType: out.contentType.startsWith("video/") ? out.contentType : "video/mp4" };
    },
    async cancelVideo(taskId: string) {
      requireConfigured(env);
      const res = await fetchImpl(`${HIGGSFIELD_API_BASE}/requests/${encodeURIComponent(taskId)}/cancel`, { method: "POST", headers: headers(env) });
      // 400 = already completed / not cancellable; 404 = unknown — nothing left to cancel either way.
      if (!res.ok && res.status !== 400 && res.status !== 404) throw new SocialGenerationFailedError(LABEL, `cancel failed (${res.status})`, res.status >= 500);
    },
  };
}
