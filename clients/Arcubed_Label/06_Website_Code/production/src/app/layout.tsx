import type { Metadata, Viewport } from "next";
import { Inter, Bodoni_Moda } from "next/font/google";
import "./globals.css";
import ScrollReset from "@/components/ScrollReset";
import { CartProvider } from "@/lib/cart-context";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import CartDrawer from "@/components/CartDrawer";
import Toaster from "@/components/Toaster";

// Variable, with the optical-size axis exposed. Fraunces at its default
// optical size is drawn for text; the homepage sets it at 200px+, where the
// display cut has finer joins and tighter apertures. That is most of why the
// headline read as unresolved rather than as art-directed.

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

// The headline candidates that lost the comparison (Instrument Serif, Playfair
// Display, Archivo) now live in /dev/type, the only page that renders them.
// Declaring them here put three unused webfont families on every customer
// route for the sake of one internal specimen page.

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
    // Nova leads the collection (client, 2026-09), so it is what a shared
    // link shows: the real Gold Nova cut-out on the brand field.
    images: [{ url: "/media/og-nova.jpg", width: 1200, height: 630, alt: "Nova in Gold, hand-crocheted by Arcubed" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Arcubed Label | Handmade Crochet Bags",
    description: "Hand-crocheted bags made to order in Amman, Jordan.",
    images: ["/media/og-nova.jpg"],
  },
  // Still closed to search engines. This is a launch switch, not an oversight:
  // set NEXT_PUBLIC_ALLOW_INDEXING=true once the client approves going live.
  robots:
    process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true"
      ? { index: true, follow: true }
      : { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#FFFFFF",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the inline script below adds `js` to this
    // element before React hydrates, so the server and client className can
    // never match. Without this every page logged a hydration error.
    <html lang="en" suppressHydrationWarning
          className={`${bodoni.variable} ${inter.variable}`}>
      <head>
        {/* Marks the document as JS-capable BEFORE first paint. Scroll-reveal
            CSS hides content only under `.js`, so if JavaScript fails or is
            disabled the page renders fully visible instead of blank below the
            hero — which is exactly what happened before this existed. Inline
            and synchronous on purpose: a deferred script would flash.

            It also sets the scroll-restoration policy for the HOMEPAGE, and it
            has to happen here rather than in a component: the browser restores
            scroll during navigation, long before React hydrates, so anything
            that runs later can only correct the position after it has already
            been painted — which is the jump this is meant to remove.

            THE BUG THIS FIXES. `history.scrollRestoration` defaults to `auto`,
            so reloading the homepage put the visitor back where they were.
            On an ordinary page that is correct and helpful. Here the first
            240-440vh is a single sticky stage, so a restored offset does not
            show the content you were reading — it shows one frame of a story
            you never started, or, past the stage, the footer. Measured on a
            production build: reloading at the bottom landed at scrollY 5673
            (375x812) and 3693 (1440x900), phase `final`, hero off screen.
            Whether it happened at all varied by viewport, which is why it
            showed up as an intermittent "sometimes the footer loads first".

            Back and Forward are left alone deliberately: restoring position is
            what those gestures mean, and bfcache restores report the same
            navigation type. Only `reload` and a fresh `navigate` are pinned to
            the top. No timers, no scrollTo, no hiding the page: suppressing
            the restore before it happens means there is nothing to correct
            afterwards.

            Restoration is handed back on `pagehide`, NOT on `load`. Chrome
            does not always restore before the load event — when the document
            is still growing (images, fonts) it retries afterwards, so a
            handler that re-enabled `auto` at `load` re-armed restoration just
            in time for that late attempt. That is what made the bug
            intermittent: the same reload landed at scrollY 0 or at 4205
            depending on which finished first. `pagehide` is after every
            restore attempt for this document and before the entry is left, so
            Back still restores normally on the way in.

            THE `z()` GUARD. `manual` is the fix; this is the belt. Measured on
            a throttled production build, a reload from the bottom still landed
            at scrollY 725 (1440), 865 (375) and 907 (430) — mid-story, on the
            customisation and material phases — with the document already at
            full height, `history.scrollRestoration` reading `manual`, and NO
            scroll event ever firing. An offset applied at document creation
            with no event is the browser positioning the document itself, and
            on that path `manual` did not suppress it.

            So on the navigations we have already decided must start at the
            top, the position is asserted once at DOMContentLoaded and once at
            load. Both are real lifecycle events, not timers — there is no
            setTimeout, no delay, no polling, and no hiding the page. It only
            ever runs when scrollY is already non-zero on a navigation we
            classified as reload-or-fresh, so Back is never touched. */}
        {/* CRITICAL SHELL GEOMETRY, inline and first.
            The homepage is force-dynamic, so App Router flushes the shell —
            header, the loading.tsx fallback, footer — and streams `main`
            afterwards. Whatever styles that fallback is entirely decides
            whether the footer sits below the fold during that window.

            This lived in globals.css, which IS the layout chunk and does load
            before the page chunk. That was still the wrong place: it makes the
            single most important rule on the site depend on an external
            stylesheet arriving and being applied before paint. A cache miss, a
            dropped chunk, or an engine that paints earlier than Chromium does
            and the fallback has no height — which is precisely the failure
            being chased, and precisely the thing that is hard to reproduce on
            a desktop.

            Inline in <head> it is in the first bytes of the response, ahead of
            every <link>, and cannot fail independently of the document.
            Literal colours rather than custom properties for the same reason:
            :root is declared in that same external stylesheet.

            Result: header + shell is always taller than one phone viewport, so
            the footer physically starts below it. */}
        <style
          id="shell-critical"
          dangerouslySetInnerHTML={{
            __html:
              ".ed-hero{position:relative;min-height:100vh;min-height:100svh;background:#ffe0fd;overflow:hidden}" +
              ".ed-skel-block{position:absolute;left:0;right:0;bottom:0;height:42%;background:#fff}" +
              ".ed-skel-type{position:absolute;left:5vw;top:22vh;width:58%;max-width:520px;height:26vh;" +
              "background:#143562;opacity:.06;border-radius:2px}" +
              ".ed-skel-object{position:absolute;right:-6vw;top:30vh;width:52vw;height:34vh;" +
              "background:#143562;opacity:.05;border-radius:44% 44% 38% 38%}" +
              "@media(max-width:860px){.ed-skel-type{top:18vh;width:78%;height:22vh}" +
              ".ed-skel-object{right:-10vw;top:44vh;width:96vw;height:30vh}}",
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "document.documentElement.classList.add('js');" +
              "try{if(location.pathname==='/'&&'scrollRestoration' in history){" +
              "var n=performance.getEntriesByType&&performance.getEntriesByType('navigation')[0];" +
              "var t=n?n.type:(performance.navigation&&performance.navigation.type===2?'back_forward':'navigate');" +
              "if(t!=='back_forward'){history.scrollRestoration='manual';" +
              "var z=function(){if(window.scrollY>0)window.scrollTo(0,0)};" +
              "addEventListener('DOMContentLoaded',z,{once:true});" +
              "addEventListener('load',z,{once:true});" +
              "addEventListener('pagehide',function(){try{history.scrollRestoration='auto'}catch(e){}},{once:true});" +
              "}}}catch(e){}",
          }}
        />
      </head>
      <body>
        <ScrollReset />
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
