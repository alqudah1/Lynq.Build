import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    // Rendered reels (about 25 MB) only travel with the two places that load a week plan: the cron and the calendar's "Load plan" action.
    "/api/internal/runtime/cron": ["./src/assets/reels/**/*"],
    "/app/*/social/calendar": ["./src/assets/reels/**/*"],
    "/*": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./public/content-studio/codeitlearn/**/*",
      "./public/content-studio/lynq/**/*",
      // Story cards and highlight covers render text through librsvg; the fonts must travel with the function.
      "./src/assets/fonts/**/*",
      "./src/assets/cases/**/*",
      // CodeIt story cards composite the brand logo.
      "./src/assets/brand/**/*",
    ],
  },
  // This repo also contains an unrelated static site (and its own
  // lockfile) at the repository root. Pinning the workspace root here
  // stops Turbopack from misidentifying it as this app's root — see
  // https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack#root-directory
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
