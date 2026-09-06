import { ImageResponse } from "next/og";

// Real Arcubed navy as a solid-colour favicon. The client's supplied logo
// (02_Branding/) is a full wordmark — illegible at 32px — and no separate
// monogram/icon mark has been supplied, so this uses the confirmed brand
// navy rather than a placeholder colour. Worth asking Rand whether a
// dedicated square mark exists for a sharper favicon later.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 8,
          background: "#143562",
        }}
      />
    ),
    { ...size }
  );
}
