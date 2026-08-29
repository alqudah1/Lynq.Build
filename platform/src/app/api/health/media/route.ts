import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { list } from "@vercel/blob";
import ffmpegPath from "ffmpeg-static";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const execFileAsync = promisify(execFile);

export async function GET() {
  try {
    if (!ffmpegPath) {
      throw new Error("Media renderer binary is unavailable.");
    }

    await execFileAsync(ffmpegPath, ["-version"], {
      timeout: 10_000,
      maxBuffer: 256 * 1024,
    });
    await list({ limit: 1 });

    return Response.json(
      { status: "ok", renderer: "ready", storage: "connected" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "error", renderer: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
