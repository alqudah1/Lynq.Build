import "server-only";

import { z } from "zod";

const runwayCreateTaskSchema = z.object({ id: z.string().min(1) });
const runwayTaskSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["PENDING", "THROTTLED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]),
  output: z.array(z.string().url()).optional(),
  failure: z.string().optional(),
  failureCode: z.string().optional(),
});

type RunwayDependencies = {
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  apiSecret?: string;
  model?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
};

export const RUNWAY_API_VERSION = "2024-11-06";
export const DEFAULT_RUNWAY_VIDEO_MODEL = "gen4.5";

export function isRunwayPremiumRendererConfigured() {
  return Boolean(process.env.RUNWAYML_API_SECRET?.trim());
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function runwayHeaders(apiSecret: string) {
  return {
    Authorization: `Bearer ${apiSecret}`,
    "Content-Type": "application/json",
    "X-Runway-Version": RUNWAY_API_VERSION,
  };
}

async function readJson(response: Response) {
  const body = await response.text();
  if (!response.ok) {
    // Provider bodies can contain internal request details. Keep the user-facing
    // failure bounded and never persist the response or the credential.
    throw new Error(`Runway request failed (${response.status})`);
  }
  return JSON.parse(body) as unknown;
}

export async function generateRunwayMotionClip(
  input: { promptImage: Uint8Array; imageContentType: "image/png" | "image/jpeg"; promptText: string },
  dependencies: RunwayDependencies = {},
) {
  const apiSecret = dependencies.apiSecret ?? process.env.RUNWAYML_API_SECRET?.trim();
  if (!apiSecret) throw new Error("Runway premium motion is not connected. Add RUNWAYML_API_SECRET to the isolated LYNQ Office Vercel project.");
  const request = dependencies.fetch ?? fetch;
  const wait = dependencies.sleep ?? sleep;
  const timeoutMs = dependencies.timeoutMs ?? 7 * 60_000;
  const pollIntervalMs = dependencies.pollIntervalMs ?? 2_500;
  const model = dependencies.model ?? process.env.RUNWAYML_VIDEO_MODEL?.trim() ?? DEFAULT_RUNWAY_VIDEO_MODEL;
  const promptImage = `data:${input.imageContentType};base64,${Buffer.from(input.promptImage).toString("base64")}`;

  const created = runwayCreateTaskSchema.parse(await readJson(await request("https://api.dev.runwayml.com/v1/image_to_video", {
    method: "POST",
    headers: runwayHeaders(apiSecret),
    body: JSON.stringify({ model, promptImage, promptText: input.promptText.slice(0, 1_000), ratio: "720:1280", duration: 5 }),
  })));

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = runwayTaskSchema.parse(await readJson(await request(`https://api.dev.runwayml.com/v1/tasks/${encodeURIComponent(created.id)}`, {
      headers: runwayHeaders(apiSecret),
    })));
    if (task.status === "SUCCEEDED") {
      const outputUrl = task.output?.[0];
      if (!outputUrl) throw new Error("Runway completed without a video output");
      const mediaResponse = await request(outputUrl);
      if (!mediaResponse.ok) throw new Error(`Runway video download failed (${mediaResponse.status})`);
      const contentType = mediaResponse.headers.get("content-type")?.split(";")[0] ?? "video/mp4";
      if (!contentType.startsWith("video/")) throw new Error("Runway returned an unexpected media type");
      const bytes = new Uint8Array(await mediaResponse.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > 100 * 1024 * 1024) throw new Error("Runway returned an invalid video size");
      return { bytes, contentType, model: `runway/${model}`, taskId: task.id };
    }
    if (task.status === "FAILED" || task.status === "CANCELLED") {
      throw new Error(`Runway generation ${task.status.toLowerCase()}${task.failureCode ? ` (${task.failureCode})` : ""}`);
    }
    await wait(pollIntervalMs);
  }
  throw new Error("Runway generation timed out; retry the premium render");
}
