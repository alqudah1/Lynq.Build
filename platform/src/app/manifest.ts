import type { MetadataRoute } from "next";

/** Installable "LYNQ Office" app: Add to Home Screen opens app.lynq.build full screen, no browser chrome. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LYNQ Office",
    short_name: "LYNQ",
    description: "Run LYNQ and CodeIt from your phone: approve posts, plan the week, see what needs you.",
    start_url: "/app",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0b0c",
    theme_color: "#0b0b0c",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
