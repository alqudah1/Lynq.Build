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
const BANDS: [string, number, number][] = [
  ["--b-hero", 0.0, 0.18],
  ["--b-enter", 0.18, 0.38],
  ["--b-mat", 0.38, 0.55],
  ["--b-shape", 0.55, 0.7],
  ["--b-cust", 0.7, 0.88],
  ["--b-final", 0.88, 1.0],
];

function band(p: number, a: number, b: number) {
  return Math.min(1, Math.max(0, (p - a) / (b - a)));
}

export default function ScrollStory({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;

    const tick = () => {
      raf = 0;
      const el = outer.current;
      const st = stage.current;
      if (!el || !st) return;
      const travel = el.offsetHeight - window.innerHeight;
      const p = travel <= 0 ? 0 : Math.min(1, Math.max(0, -el.getBoundingClientRect().top / travel));
      st.style.setProperty("--p", p.toFixed(4));
      for (const [name, a, b] of BANDS) st.style.setProperty(name, band(p, a, b).toFixed(4));

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
    reduce.addEventListener("change", onPrefChange);
    return () => {
      stop();
      reduce.removeEventListener("change", onPrefChange);
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
