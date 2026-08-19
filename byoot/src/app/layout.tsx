import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "BYOOT (scaffold)",
  description: "Foundation scaffold — see byoot/README.md before treating anything here as production-ready.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
