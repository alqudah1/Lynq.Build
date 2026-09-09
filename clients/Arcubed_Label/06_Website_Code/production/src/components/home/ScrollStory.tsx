"use client";

// One scroll timeline for the whole homepage story.
//
// The outer element is tall; the stage inside it is sticky and 100vh, so the
// page scrolls normally while the composition stays put and CHANGES. Nothing
// here hijacks the scroll: no wheel handlers, no scrollTo, no snapping. The
// user scrolls at whatever speed they like and the story follows.
//
// The driver writes a single normalised progress (`--p`, 0 to 1) plus one
// variable per phase, each also 0 to 1 within its own band. Every animated
// property on the page is then plain CSS reading those numbers through
// calc(). That is deliberate: it keeps the motion in one place instead of
// scattered across a dozen IntersectionObservers, and it means
// prefers-reduced-motion can switch the whole thing off with a couple of
// rules rather than by unwinding JavaScript.

import { useEffect, useRef, type ReactNode } from "react";

/** [custom property, start, end] over global progress. */
// The hero band is short on purpose. It used to run to 18% of a 460vh
// container — about 700px of scrolling before anything moved much, which
// read as an unresponsive page rather than as a held frame. The first
// gesture now visibly moves the composition and the enter sequence starts
// almost immediately after it.
// Re-spaced for a 240vh container. Every band is now short enough that one
// wheel gesture moves the composition into the next idea; the closing frame in
// particular resolves fast so the customer is not scrolling to escape the
// story before the collection arrives.
const DESKTOP_BANDS: [string, number, number][] = [
  ["--b-hero", 0.0, 0.05],
  ["--b-enter", 0.05, 0.24],
  // Material and shape were 2 wheel gestures each, so the handoff from the
  // material into the four forms cost 4. Tightened to land it at 3 without
  // changing the story's overall height; the room goes to customisation,
  // which is the one phase that genuinely needs dwell.
  ["--b-mat", 0.24, 0.40],
  ["--b-shape", 0.40, 0.56],
  ["--b-cust", 0.56, 0.84],
  ["--b-final", 0.84, 1.0],
];

// A phone is not the desktop story at a smaller width.
//
// Measured with real touch swipes (scripts/measure-mobile-story.mjs), the old
// mobile story was 210vh, which at 375x812 is 893px of travel. One deliberate
// swipe scrolls about 320px, so the WHOLE story was 2.8 swipes and three
// phases — enter, shape and closing — were never the visible frame after any
// swipe. They existed only in the blur between two gestures.
//
// The fix is length plus a different distribution, not the desktop numbers on
// a shorter page. Desktop trades dwell for speed because a wheel gesture is
// cheap and repeatable; a thumb flick is neither, so on a phone every phase
// gets at least a full swipe and the three that carry the actual product
// information get more.
const MOBILE_BANDS: [string, number, number][] = [
  ["--b-hero", 0.0, 0.05],
  // A wide opening on purpose. At 0.05-0.22 the first swipe landed 44% into
  // the enter sequence and the headline was already gone, which is not a
  // transition beginning, it is the hero being destroyed by one gesture.
  ["--b-enter", 0.05, 0.26],
  ["--b-mat", 0.26, 0.45],
  ["--b-shape", 0.45, 0.62],
  // The largest share on a phone. This is the only frame where the customer
  // sees a colour being chosen, and it was previously one swipe.
  ["--b-cust", 0.62, 0.86],
  ["--b-final", 0.86, 1.0],
];

/** Must match the breakpoint the mobile story height is set at in home.css. */
const MOBILE_QUERY = "(max-width: 860px)";

function band(p: number, a: number, b: number) {
  return Math.min(1, Math.max(0, (p - a) / (b - a)));
}

export default function ScrollStory({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobile = window.matchMedia(MOBILE_QUERY);
    let bands = mobile.matches ? MOBILE_BANDS : DESKTOP_BANDS;
    let raf = 0;

    const tick = () => {
      raf = 0;
      const el = outer.current;
      const st = stage.current;
      if (!el || !st) return;
      const travel = el.offsetHeight - window.innerHeight;
      const p = travel <= 0 ? 0 : Math.min(1, Math.max(0, -el.getBoundingClientRect().top / travel));
      st.style.setProperty("--p", p.toFixed(4));
      for (const [name, a, b] of bands) st.style.setProperty(name, band(p, a, b).toFixed(4));

      // Drives the header, which lives outside this component. It belongs to
      // the hero composition at the top, gets out of the way while the story
      // is playing, and comes back as a minimal bar once the story releases
      // into the collection — where a visitor actually needs to navigate
      // again.
      const named = p >= 0.995 ? "done" : p > 0.04 ? "running" : "hero";
      if (document.documentElement.dataset.story !== named) {
        document.documentElement.dataset.story = named;
      }
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const start = () => {
      // Reduced motion never subscribes, so the CSS static fallback holds and
      // no work happens on scroll at all.
      if (reduce.matches) return;
      tick();
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll);
    };
    const stop = () => {
      delete document.documentElement.dataset.story;
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    start();
    const onPrefChange = () => {
      stop();
      start();
    };
    // Rotating a phone crosses the breakpoint, so the timeline has to follow.
    // Still one scroll listener and one rAF: this only swaps which numbers the
    // existing driver reads.
    const onBreakpoint = () => {
      bands = mobile.matches ? MOBILE_BANDS : DESKTOP_BANDS;
      onScroll();
    };
    reduce.addEventListener("change", onPrefChange);
    mobile.addEventListener("change", onBreakpoint);
    return () => {
      stop();
      reduce.removeEventListener("change", onPrefChange);
      mobile.removeEventListener("change", onBreakpoint);
    };
  }, []);

  return (
    <div className="story" ref={outer}>
      <div className="story-stage" ref={stage}>
        {children}
      </div>
    </div>
  );
}
