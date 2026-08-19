import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This repo also contains other, unrelated apps and a static site at the
  // repository root (see LYNQ_ENGINEERING_STANDARD.md Part A) — pinning the
  // workspace root here stops Turbopack from misidentifying one of them as
  // this app's root. Same reasoning as platform/next.config.ts.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
