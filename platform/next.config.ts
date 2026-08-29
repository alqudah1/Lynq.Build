import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./public/content-studio/codeitlearn/**/*",
      "./public/content-studio/lynq/**/*",
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
