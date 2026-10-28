/**
 * Renders the bundled reels. Skipped in normal test runs; run on purpose with
 *   RENDER_REELS=1 npx vitest run src/lib/social-os/reel-render.render.test.ts
 * (optionally REEL=<file> to render one). Needs ffmpeg on the PATH.
 */
import { describe, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FPS, REELS } from "./reel-render";
import { prepareFonts } from "./story-card";

const OUT = path.join(process.cwd(), "src", "assets", "reels");

describe.runIf(process.env.RENDER_REELS)("render reels", () => {
  for (const reel of REELS.filter((r) => !process.env.REEL || r.file === process.env.REEL)) {
    it(reel.file, async () => {
      prepareFonts();
      const sharp = (await import("sharp")).default;
      const dir = mkdtempSync(path.join(os.tmpdir(), "reel-"));
      const frames = Math.round(reel.seconds * FPS);
      for (let i = 0; i < frames; i++) {
        const png = await sharp(Buffer.from(reel.frame(i / FPS))).png({ compressionLevel: 1 }).toBuffer();
        writeFileSync(path.join(dir, `f${String(i).padStart(5, "0")}.png`), png);
      }
      mkdirSync(OUT, { recursive: true });
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(dir, "f%05d.png"), "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-shortest", "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", path.join(OUT, reel.file)]);
      rmSync(dir, { recursive: true, force: true });
    }, 600_000);
  }
});
