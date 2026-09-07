import type { Metadata, Viewport } from "next";
import { Fraunces, Inter, Bodoni_Moda } from "next/font/google";
import "./globals.css";
import { CartProvider } from "@/lib/cart-context";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import CartDrawer from "@/components/CartDrawer";
import Toaster from "@/components/Toaster";

// Variable, with the optical-size axis exposed. Fraunces at its default
// optical size is drawn for text; the homepage sets it at 200px+, where the
// display cut has finer joins and tighter apertures. That is most of why the
// headline read as unresolved rather than as art-directed.
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-head",
  display: "swap",
  axes: ["opsz", "SOFT"],
});

// Display face for the hero. Bodoni Moda is a true fashion masthead cut: very
// high stroke contrast, a real italic, and an optical-size axis. Fraunces is a
// soft serif built for text and stays for body headings; using one family at
// three sizes was most of why the hero read as unresolved rather than
// art-directed. OFL licensed, self-hosted by next/font, so it ships legally.
const bodoni = Bodoni_Moda({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  style: ["normal", "italic"],
  axes: ["opsz"],
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://arcubed-label.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "Arcubed Label | Handmade Crochet Bags",
    template: "%s | Arcubed Label",
  },
  description:
    "Hand-crocheted bags made to order in Amman, Jordan. Choose your shape, your colour and your fittings.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Arcubed Label",
    title: "Arcubed Label | Handmade Crochet Bags",
    description:
      "Hand-crocheted bags made to order in Amman, Jordan. Choose your shape, your colour and your fittings.",
    url: SITE,
    locale: "en_JO",
  },
  twitter: {
    card: "summary_large_image",
    title: "Arcubed Label | Handmade Crochet Bags",
    description: "Hand-crocheted bags made to order in Amman, Jordan.",
  },
  // Still closed to search engines. This is a launch switch, not an oversight:
  // set NEXT_PUBLIC_ALLOW_INDEXING=true once the client approves going live.
  robots:
    process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true"
      ? { index: true, follow: true }
      : { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#FAF6F1",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${bodoni.variable} ${inter.variable}`}>
      <head>
        {/* Marks the document as JS-capable BEFORE first paint. Scroll-reveal
            CSS hides content only under `.js`, so if JavaScript fails or is
            disabled the page renders fully visible instead of blank below the
            hero — which is exactly what happened before this existed. Inline
            and synchronous on purpose: a deferred script would flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: "document.documentElement.classList.add('js')",
          }}
        />
      </head>
      <body>
        <CartProvider>
          <Header />
          <main>{children}</main>
          <Footer />
          <CartDrawer />
          <Toaster />
        </CartProvider>
      </body>
    </html>
  );
}
