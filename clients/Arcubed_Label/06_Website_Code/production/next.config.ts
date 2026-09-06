import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  // Dev-server only. Without this, `next dev` serves the page HTML but 403s
  // every client chunk requested over 127.0.0.1 rather than localhost, so
  // nothing hydrates and the 3D canvas silently stays at its 300x150 default
  // — which looks exactly like a broken model. Has no effect on a production
  // build.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
