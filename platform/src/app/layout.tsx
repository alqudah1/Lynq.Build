import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LYNQ Core Platform",
  description: "The internal operating platform for LYNQ.",
  applicationName: "LYNQ Office",
  manifest: "/manifest.webmanifest",
  // Installed from Safari's share sheet it runs full screen like an app, with the status bar blending into the dark header.
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "LYNQ" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0c",
  // `cover` lets the layout extend under the notch and home indicator; components pad with env(safe-area-inset-*) where needed.
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
