import { SocialGenerationFailedError, SocialProviderNotConfiguredError } from "../../errors";
import { bytesToBase64, defaultFetch, downloadBytes, present, requestJson, type ProviderDeps, type SocialAiEnv } from "./http";
import type { ImageGenerationRequest, ImageGenerationResult, ImageProvider, VideoGenerationRequest, VideoProvider, VideoTaskStatus } from "./types";

/**
 * Module 19 — Runway (api.dev.runwayml.com) video and image providers.
 * Request shapes follow the existing Marketing OS Runway client
 * (`src/lib/marketing-os/providers/runway.ts`): Bearer secret,
 * `X-Runway-Version: 2024-11-06`, task id → `GET /tasks/{id}`.
 */

export const RUNWAY_API_BASE = "https://api.dev.runwayml.com/v1";
export const RUNWAY_API_VERSION = "2024-11-06";
export const DEFAULT_RUNWAY_VIDEO_MODEL = "gen4.5";
export const DEFAULT_RUNWAY_IMAGE_MODEL = "gen4_image";
const LABEL = "Runway";
const DEFAULT_MAX_VIDEO_BYTES = 200 * 1024 * 1024;

const VIDEO_RATIOS: Record<VideoGenerationRequest["aspectRatio"], string> = { "9:16": "720:1280", "16:9": "1280:720", "1:1": "960:960" };
const IMAGE_RATIOS: Record<ImageGenerationRequest["aspectRatio"], { ratio: string; width: number; height: number }> = {
  "1:1": { ratio: "1080:1080", width: 1080, height: 1080 },
  "4:5": { ratio: "1080:1350", width: 1080, height: 1350 },
  "9:16": { ratio: "1080:1920", width: 1080, height: 1920 },
  "16:9": { ratio: "1920:1080", width: 1920, height: 1080 },
  "3:2": { ratio: "1440:960", width: 1440, height: 960 },
};

/** Public per-second prices (USD) from Runway's credit pricing; null when unknown. */
export function runwayCostPerSecondUsd(model: string): number | null {
  if (model === "gen4.5") return 0.12;
  if (model === "gen4_turbo") return 0.05;
  return null;
}

export const RUNWAY_IMAGE_COST_USD = 0.08;

function missing(env: SocialAiEnv): string[] {
  return present(env.RUNWAYML_API_SECRET) ? [] : ["RUNWAYML_API_SECRET"];
}

function headers(env: SocialAiEnv): Record<string, string> {
  return { Authorization: `Bearer ${env.RUNWAYML_API_SECRET!.trim()}`, "Content-Type": "application/json", "X-Runway-Version": RUNWAY_API_VERSION };
}

function requireConfigured(env: SocialAiEnv): void {
  const m = missing(env);
  if (m.length) throw new SocialProviderNotConfiguredError(LABEL, m);
}

interface RunwayTask {
  id?: string;
  status?: string;
  output?: string[];
  failure?: string;
  failureCode?: string;
}

/** Runway task status → our VideoTaskStatus. */
export function mapRunwayTask(task: RunwayTask): VideoTaskStatus {
  switch (task.status) {
    case "PENDING":
    case "THROTTLED":
      return { status: "pending" };
    case "RUNNING":
      return { status: "running" };
    case "SUCCEEDED": {
      const outputUrl = task.output?.[0];
      return outputUrl ? { status: "succeeded", outputUrl } : { status: "failed", failureCode: "no_output", failureMessage: "Runway completed without an output" };
    }
    case "FAILED":
      return { status: "failed", failureCode: task.failureCode ?? "failed", failureMessage: (task.failure ?? "Runway reported a failure").slice(0, 300) };
    case "CANCELLED":
      return { status: "cancelled" };
    default:
      return { status: "pending" };
  }
}

async function getTask(fetchImpl: ReturnType<typeof defaultFetch>, env: SocialAiEnv, taskId: string): Promise<RunwayTask> {
  return (await requestJson(fetchImpl, LABEL, `${RUNWAY_API_BASE}/tasks/${encodeURIComponent(taskId)}`, { method: "GET", headers: headers(env) })) as RunwayTask;
}

export function createRunwayVideoProvider(env: SocialAiEnv, deps?: ProviderDeps): VideoProvider {
  const fetchImpl = defaultFetch(deps);
  const defaultModel = env.RUNWAYML_VIDEO_MODEL?.trim() || DEFAULT_RUNWAY_VIDEO_MODEL;
  return {
    id: "runway",
    kind: "video",
    label: LABEL,
    defaultModel,
    missingConfiguration: () => missing(env),
    estimatedCostPerSecondUsd: (model?: string) => runwayCostPerSecondUsd(model ?? defaultModel),
    async startVideo(request: VideoGenerationRequest, options?: { model?: string }) {
      requireConfigured(env);
      const model = options?.model ?? defaultModel;
      const body: Record<string, unknown> = { model, promptText: request.prompt.slice(0, 1000), ratio: VIDEO_RATIOS[request.aspectRatio], duration: request.durationSeconds };
      let path = "/text_to_video";
      if (request.promptImage) {
        path = "/image_to_video";
        body.promptImage = `data:${request.promptImage.contentType};base64,${bytesToBase64(request.promptImage.bytes)}`;
      }
      const created = (await requestJson(fetchImpl, LABEL, `${RUNWAY_API_BASE}${path}`, { method: "POST", headers: headers(env), body: JSON.stringify(body) })) as { id?: string };
      if (!created.id) throw new SocialGenerationFailedError(LABEL, "the provider returned no task id", true);
      return { taskId: created.id, model };
    },
    async pollVideo(taskId: string) {
      requireConfigured(env);
      return mapRunwayTask(await getTask(fetchImpl, env, taskId));
    },
    async downloadVideo(outputUrl: string, options?: { maxBytes?: number }) {
      const out = await downloadBytes(fetchImpl, LABEL, outputUrl, options?.maxBytes ?? DEFAULT_MAX_VIDEO_BYTES);
      const contentType = out.contentType.startsWith("video/") ? out.contentType : "video/mp4";
      return { bytes: out.bytes, contentType };
    },
    async cancelVideo(taskId: string) {
      requireConfigured(env);
      const res = await fetchImpl(`${RUNWAY_API_BASE}/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE", headers: headers(env) });
      if (!res.ok && res.status !== 404) throw new SocialGenerationFailedError(LABEL, `cancel failed (${res.status})`, res.status >= 500);
    },
  };
}

export function createRunwayImageProvider(env: SocialAiEnv, deps?: ProviderDeps & { sleep?: (ms: number) => Promise<void>; pollIntervalMs?: number; timeoutMs?: number }): ImageProvider {
  const fetchImpl = defaultFetch(deps);
  const sleep = deps?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollIntervalMs = deps?.pollIntervalMs ?? 2000;
  const timeoutMs = deps?.timeoutMs ?? 120_000;
  return {
    id: "runway",
    kind: "image",
    label: LABEL,
    defaultModel: DEFAULT_RUNWAY_IMAGE_MODEL,
    missingConfiguration: () => missing(env),
    async generateImage(request: ImageGenerationRequest, options?: { model?: string; signal?: AbortSignal }): Promise<ImageGenerationResult> {
      requireConfigured(env);
      const model = options?.model ?? DEFAULT_RUNWAY_IMAGE_MODEL;
      const size = IMAGE_RATIOS[request.aspectRatio] ?? IMAGE_RATIOS["1:1"];
      const promptText = (request.style ? `${request.prompt}\n\nStyle: ${request.style}` : request.prompt).slice(0, 1000);
      const created = (await requestJson(fetchImpl, LABEL, `${RUNWAY_API_BASE}/text_to_image`, { method: "POST", headers: headers(env), body: JSON.stringify({ model, promptText, ratio: size.ratio }), signal: options?.signal })) as { id?: string };
      if (!created.id) throw new SocialGenerationFailedError(LABEL, "the provider returned no task id", true);
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const status = mapRunwayTask(await getTask(fetchImpl, env, created.id));
        if (status.status === "succeeded" && status.outputUrl) {
          const out = await downloadBytes(fetchImpl, LABEL, status.outputUrl, 20 * 1024 * 1024);
          const contentType = out.contentType === "image/png" || out.contentType === "image/webp" ? out.contentType : "image/jpeg";
          return { provider: "runway", model, bytes: out.bytes, contentType, width: size.width, height: size.height, usage: { units: 1, costUsd: RUNWAY_IMAGE_COST_USD, estimated: true } };
        }
        if (status.status === "failed" || status.status === "cancelled") throw new SocialGenerationFailedError(LABEL, `image generation ${status.status}${status.failureCode ? ` (${status.failureCode})` : ""}`, false);
        if (Date.now() >= deadline) throw new SocialGenerationFailedError(LABEL, "image generation timed out", true);
        await sleep(pollIntervalMs);
      }
    },
  };
}
