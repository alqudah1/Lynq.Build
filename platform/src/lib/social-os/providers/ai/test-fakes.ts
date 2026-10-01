import type { SocialAssetStorage } from "../../assets";
import type { ImageGenerationRequest, ImageProvider, TextGenerationRequest, TextGenerationResult, TextProvider, VideoGenerationRequest, VideoProvider, VideoTaskStatus } from "./types";

/** Test doubles for the creative AI layer (no network, no DB). */

export function fakeTextProvider(respond: (req: TextGenerationRequest, call: number) => { text?: string; json?: unknown } | Promise<{ text?: string; json?: unknown }>, options: { id?: "anthropic" | "openai" | "gateway"; model?: string } = {}) {
  const calls: TextGenerationRequest[] = [];
  const provider: TextProvider = {
    id: options.id ?? "anthropic",
    kind: "text",
    label: "Fake text",
    defaultModel: options.model ?? "fake-text-1",
    missingConfiguration: () => [],
    async generateText(req): Promise<TextGenerationResult> {
      calls.push(req);
      const out = await respond(req, calls.length);
      const json = out.json;
      const text = out.text ?? (json !== undefined ? JSON.stringify(json) : "");
      return { provider: provider.id, model: provider.defaultModel, text, json: req.jsonSchema ? json : undefined, usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.001, estimated: true } };
    },
  };
  return { provider, calls };
}

export function fakeImageProvider(bytes: Uint8Array, contentType: "image/jpeg" | "image/png" = "image/jpeg") {
  const calls: ImageGenerationRequest[] = [];
  const provider: ImageProvider = {
    id: "openai",
    kind: "image",
    label: "Fake image",
    defaultModel: "fake-image-1",
    missingConfiguration: () => [],
    async generateImage(req) {
      calls.push(req);
      return { provider: "openai", model: "fake-image-1", bytes, contentType, width: 1, height: 1, usage: { units: 1, costUsd: 0.04, estimated: true } };
    },
  };
  return { provider, calls };
}

export function fakeVideoProvider(script: { statuses: VideoTaskStatus[]; bytes?: Uint8Array; costPerSecond?: number | null }) {
  const started: VideoGenerationRequest[] = [];
  let poll = 0;
  const provider: VideoProvider = {
    id: "runway",
    kind: "video",
    label: "Fake video",
    defaultModel: "gen4.5",
    missingConfiguration: () => [],
    estimatedCostPerSecondUsd: () => (script.costPerSecond === undefined ? 0.12 : script.costPerSecond),
    async startVideo(req) {
      started.push(req);
      return { taskId: `task-${started.length}`, model: "gen4.5" };
    },
    async pollVideo() {
      const s = script.statuses[Math.min(poll, script.statuses.length - 1)];
      poll++;
      return s;
    },
    async downloadVideo() {
      return { bytes: script.bytes ?? Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), contentType: "video/mp4" };
    },
  };
  return { provider, started, polls: () => poll };
}

/** In-memory SocialAssetStorage. */
export function memoryStorage(): SocialAssetStorage & { objects: Map<string, { bytes: Uint8Array; contentType: string }> } {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    objects,
    async put(pathname, bytes, options) {
      objects.set(pathname, { bytes, contentType: options.contentType });
      return { pathname, url: `memory://${pathname}` };
    },
    async get(pathname) {
      const o = objects.get(pathname);
      if (!o) return null;
      return { stream: new Response(o.bytes as unknown as BodyInit).body!, contentType: o.contentType, size: o.bytes.byteLength };
    },
  };
}
