"use client";

// Scroll to the top on a NEW client-side navigation.
//
// THE BUG THIS FIXES, measured on real WebKit against the deployed preview:
// go to the homepage, scroll to the footer, tap Shop, then tap the wordmark to
// come Home — and you land at scrollY 5671 (375x812), 5825 (390x844), 6293
// (430x932). Phase `final`, footer filling the screen, hero nowhere. Tapping
// "Home" from anywhere on the site put you at the bottom of the homepage.
//
// That is the report. It is NOT the streaming shell and it is NOT
// `history.scrollRestoration`: it reproduces identically on builds from before
// any of that work, with restoration still on `auto`.
//
// It is an engine difference in App Router's client navigation. Next's
// documented behaviour is to scroll to the top for a new navigation and to
// restore only for back/forward. Chromium does that; WebKit carries the
// previous scroll position for the route instead, which is why Chromium-only
// testing never saw it and an iPhone always did.
//
// So this restores the documented behaviour rather than inventing any:
//   · first render is left completely alone — a fresh load, a reload and a
//     bfcache restore are all handled before React exists (see the inline
//     script in layout.tsx) and must not be second-guessed here
//   · a popstate navigation (Back/Forward) is left alone, because restoring
//     position is what those gestures mean
//   · any other pathname change is a new navigation, and goes to the top
//
// No timers, no polling, no route allow-list: this is every route, because
// "a new navigation starts at the top" is not homepage-specific.

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export default function ScrollReset() {
  const pathname = usePathname();
  const firstRender = useRef(true);
  const cameFromHistory = useRef(false);

  useEffect(() => {
    const onPopState = () => {
      cameFromHistory.current = true;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    // The initial document. Restoration for this one was already decided
    // before hydration; touching it here would override a legitimate
    // Back/bfcache restore.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // Back or Forward: leave the position exactly where the browser put it.
    if (cameFromHistory.current) {
      cameFromHistory.current = false;
      return;
    }
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
