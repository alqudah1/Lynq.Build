/**
 * Module 19 — creative AI provider abstraction. Three narrow interfaces
 * (text, image, video) and a registry that reports availability from
 * environment configuration. Nothing in `social-os` imports a vendor SDK
 * directly; everything goes through these contracts so a provider can be
 * swapped, added, or absent without the rest of the Social Command Center
 * noticing.
 *
 * Providers never touch the database. The generation service
 * (`../../generation.ts`) records every call in `social_ai_generations`
 * before and after it runs, with the provider/model/usage/cost these
 * interfaces return.
 */

export type AiProviderId = "anthropic" | "openai" | "gateway" | "runway" | "higgsfield" | "lynq_renderer";

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** Provider-reported cost in USD when available; otherwise estimated by the provider module from its public price list, flagged `estimated`. */
  costUsd?: number;
  estimated?: boolean;
  /** Seconds of video / number of images produced. */
  units?: number;
}

export interface TextGenerationRequest {
  system: string;
  prompt: string;
  /** When set, the provider must return JSON matching this JSON Schema (validated again by the caller). */
  jsonSchema?: Record<string, unknown>;
  maxOutputTokens?: number;
  temperature?: number;
  /** Caller-supplied idempotency key, forwarded where the provider supports it. */
  idempotencyKey?: string;
}

export interface TextGenerationResult {
  provider: AiProviderId;
  model: string;
  text: string;
  /** Parsed JSON when `jsonSchema` was requested. */
  json?: unknown;
  usage: AiUsage;
}

export interface TextProvider {
  id: AiProviderId;
  kind: "text";
  label: string;
  defaultModel: string;
  missingConfiguration(): string[];
  generateText(request: TextGenerationRequest, options?: { model?: string; signal?: AbortSignal }): Promise<TextGenerationResult>;
}

export interface ImageGenerationRequest {
  prompt: string;
  /** Target aspect ratio e.g. "1:1", "4:5", "9:16", "16:9". The provider maps it to the nearest supported size. */
  aspectRatio: "1:1" | "4:5" | "9:16" | "16:9" | "3:2";
  style?: string;
  /** Reference images (brand assets) as bytes — used by providers that support image conditioning. */
  references?: { bytes: Uint8Array; contentType: string; tag: string }[];
  idempotencyKey?: string;
}

export interface ImageGenerationResult {
  provider: AiProviderId;
  model: string;
  bytes: Uint8Array;
  contentType: "image/png" | "image/jpeg" | "image/webp";
  width?: number;
  height?: number;
  usage: AiUsage;
}

export interface ImageProvider {
  id: AiProviderId;
  kind: "image";
  label: string;
  defaultModel: string;
  missingConfiguration(): string[];
  generateImage(request: ImageGenerationRequest, options?: { model?: string; signal?: AbortSignal }): Promise<ImageGenerationResult>;
}

export interface VideoGenerationRequest {
  prompt: string;
  /** Optional first-frame image. */
  promptImage?: { bytes: Uint8Array; contentType: "image/png" | "image/jpeg" };
  aspectRatio: "9:16" | "16:9" | "1:1";
  durationSeconds: 5 | 8 | 10;
  idempotencyKey?: string;
}

/** Video generation is asynchronous: `start` returns a provider task id; `poll` reports status; `download` fetches bytes. */
export interface VideoTaskStatus {
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  outputUrl?: string;
  failureCode?: string;
  failureMessage?: string;
}

export interface VideoProvider {
  id: AiProviderId;
  kind: "video";
  label: string;
  defaultModel: string;
  missingConfiguration(): string[];
  /** Rough cost per second of output in USD from the provider's public price list (for pre-flight limits), or null if unknown. */
  estimatedCostPerSecondUsd(model?: string): number | null;
  startVideo(request: VideoGenerationRequest, options?: { model?: string }): Promise<{ taskId: string; model: string }>;
  pollVideo(taskId: string): Promise<VideoTaskStatus>;
  downloadVideo(outputUrl: string, options?: { maxBytes?: number }): Promise<{ bytes: Uint8Array; contentType: string }>;
  cancelVideo?(taskId: string): Promise<void>;
}

export type AnyAiProvider = TextProvider | ImageProvider | VideoProvider;

export interface AiProviderAvailability {
  id: AiProviderId;
  kind: "text" | "image" | "video";
  label: string;
  configured: boolean;
  missing: string[];
  defaultModel: string;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
