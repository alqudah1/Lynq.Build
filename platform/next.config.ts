import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This repo also contains an unrelated static site (and its own
  // lockfile) at the repository root. Pinning the workspace root here
  // stops Turbopack from misidentifying it as this app's root — see
  // https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack#root-directory
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
