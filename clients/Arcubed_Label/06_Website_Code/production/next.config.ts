import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  images: {
    /* WHY THIS EXISTS.
       There was no images config at all, so every derivative was encoded at
       Next's default quality of 75. On flat UI that is invisible; on fine
       crochet at poster scale it is not. The closing campaign was being
       delivered as a 1920px WebP in 115kB — enough PIXELS, nowhere near
       enough BITS — and the stitch broke down into mush on a Retina phone
       while every dimension-based audit reported the page clean.
       90 is allowlisted so the handful of images that are actually large on
       screen can opt in. Everything else stays at 75: this is a per-image
       decision, not a global one. */
    qualities: [75, 90],
    /* The default ladder jumps 2048 -> 3840. The homepage hero renders 761
       CSS px wide, which is 2283 physical on a DPR3 phone: just past 2048, so
       the browser had to reach for 3840 and the LCP arrived as a 617kB file
       for a box that needed a third of that. One rung at 2560 covers it at
       ppp 1.12 for roughly 270kB. Everything else in the ladder is Next's
       default — this adds a step, it does not replace the set. */
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 2560, 3840],
  },
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
