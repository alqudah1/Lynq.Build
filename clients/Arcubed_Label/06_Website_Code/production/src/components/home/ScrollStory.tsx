"use client";

// One scroll timeline for the whole homepage story.
//
// WHY THIS IS STATE-BASED AND NOT PER-FRAME
//
// The previous driver wrote a normalised progress value plus one variable per
// phase onto the sticky stage on every animation frame, and every animated
// property in home.css read those through calc(). It was a tidy idea and it
// was the single reason the page felt laggy. Custom properties INHERIT, so
// writing one on the stage invalidates style for the entire subtree; the
// stage holds about a hundred elements, so the browser recalculated all of
// them sixty times a second.
//
// Measured on a 390x844 phone at 4x CPU throttle, scrolling the whole story:
//
//                       per-frame writes      writes suppressed
//   style recalc        2271ms                15ms
//   paint                484ms                34ms
//   average fps           33.8                60
//   frames over 33ms      28.8%               0%
//
// Style recalculation was 67% of all main-thread work. Nothing else came
// close: paint was 10%, layout 2%. So the fix is not to paint less or to load
// fewer images, it is to stop writing to the subtree on every frame.
//
// Now the driver writes two ATTRIBUTES, and only when they actually change:
//
//   data-phase   which composition is on screen  (about five changes)
//   data-step    which colourway is chosen       (four changes)
//
// CSS transitions do the animating, on transform and opacity, which the
// compositor can run off the main thread. Each phase is a composition that
// settles rather than a composition being rebuilt from scroll position, and
// at any moment exactly one transition is in flight.
//
// Continuous motion did not disappear, it got scoped. A phase that only
// changes on state boundaries feels dead when you scroll inside it, so a few
// named elements still track progress — but the value is written on those
// LEAF elements rather than on the stage, so it invalidates two or three
// nodes instead of a hundred. That is the whole difference.

import { useEffect, useRef, type ReactNode } from "react";

/** Phase name with the progress value it starts at. */
type Band = readonly [string, number];

// Redistributed, and the story is longer on a phone, because the old split
// gave the colour sequence 761px: five colourways inside 2.4 thumb swipes, so
// a single flick skipped two of them. Customisation now takes 40% of the
// travel, which is about 300px per colourway, or roughly one deliberate swipe
// each. Nothing else lost enough to notice.
// FIVE STATES, NOT SIX. "enter" used to sit between the hero and the
// material, and as a continuously interpolated band it read as the bag
// growing into the macro. As a discrete state it read as a wall of red held
// for a seventh of the story: a composition nobody designed, showing a crop
// of a bag that is not even the colour of the macro it hands off to. The
// hero simply holds longer now and goes straight to the material.
const BANDS: readonly Band[] = [
  ["hero", 0.0],
  ["mat", 0.2],
  ["shape", 0.34],
  ["cust", 0.46],
  ["final", 0.86],
];
const DESKTOP_BANDS = BANDS;
const MOBILE_BANDS = BANDS;

const CUST_STEPS = 5;
const MOBILE_QUERY = "(max-width: 860px)";

/** Elements that keep tracking scroll, and how far they drift, in vh. */
const DRIFT: readonly [string, number][] = [
  [".hero-bag", -2.4],
  [".mat-img img", 1.8],
  [".final-bag", -2.0],
];

export default function ScrollStory({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobile = window.matchMedia(MOBILE_QUERY);
    let bands: readonly Band[] = mobile.matches ? MOBILE_BANDS : DESKTOP_BANDS;
    let raf = 0;

    // Resolved once, not per frame.
    // [element, distance in vh, last written value]
    let drift: [HTMLElement, number, number][] = [];
    const collect = () => {
      const st = stage.current;
      drift = st
        ? (DRIFT.map(([sel, amt]) => [st.querySelector(sel), amt, NaN]).filter(
            (x) => x[0]
          ) as [HTMLElement, number, number][])
        : [];
    };

    // Last written values, so a frame that changes nothing writes nothing.
    let lastPhase = "";
    let lastStep = -1;
    let lastStory = "";

    const tick = () => {
      raf = 0;
      const el = outer.current;
      const st = stage.current;
      if (!el || !st) return;

      const travel = el.offsetHeight - window.innerHeight;
      const p =
        travel <= 0
          ? 0
          : Math.min(1, Math.max(0, -el.getBoundingClientRect().top / travel));

      // Which composition is on screen.
      let i = 0;
      for (let k = 0; k < bands.length; k++) if (p >= bands[k][1]) i = k;
      const phase = bands[i][0];
      const start = bands[i][1];
      const end = i + 1 < bands.length ? bands[i + 1][1] : 1;
      const within = end > start ? (p - start) / (end - start) : 0;

      if (phase !== lastPhase) {
        lastPhase = phase;
        st.setAttribute("data-phase", phase);
        // The header sits over navy for exactly one phase, and navy needs the
        // pink wordmark. Derived from the phase rather than from a hardcoded
        // progress value, so it cannot drift out of step with the bands.
        document.documentElement.setAttribute(
          "data-ground",
          phase === "shape" ? "navy" : "light"
        );
      }

      // Drives the header, which lives outside this component: it belongs to
      // the hero at the top, gets out of the way while the story plays, and
      // returns as a minimal bar once the story releases into the collection.
      const story = p >= 0.995 ? "done" : p > 0.04 ? "running" : "hero";
      if (story !== lastStory) {
        lastStory = story;
        document.documentElement.setAttribute("data-story", story);
      }

      // Which colourway. Discrete on purpose: the customer sees a colour, a
      // transition, then the next colour, instead of five images dissolving
      // through each other while one swipe is still in progress.
      const step =
        phase === "cust"
          ? Math.min(CUST_STEPS - 1, Math.floor(within * CUST_STEPS))
          : phase === "final"
            ? CUST_STEPS - 1
            : 0;
      if (step !== lastStep) {
        lastStep = step;
        st.setAttribute("data-step", String(step));
      }

      // The only per-frame writes left, and they land on leaf elements.
      // Eased so the drift is strongest mid-phase and settles at both ends,
      // which stops it fighting the transition running at a boundary.
      //
      // QUANTISED, because a custom property write is a style invalidation
      // however small the change is. Measured at 4x CPU throttle, writing
      // these three every frame cost 183ms of recalculation and 94ms of paint
      // across a five second scroll. Rounded to a tenth of a vh the value
      // only actually changes a few dozen times per phase, the motion is
      // identical to the eye, and the writes stop being a cost worth naming.
      const ease = Math.sin(Math.min(1, Math.max(0, within)) * Math.PI);
      for (const d of drift) {
        const v = Math.round(ease * d[1] * 10) / 10;
        if (v !== d[2]) {
          d[2] = v;
          d[0].style.setProperty("--drift", v + "vh");
        }
      }
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const apply = () => {
      bands = mobile.matches ? MOBILE_BANDS : DESKTOP_BANDS;
      collect();
      lastPhase = "";
      lastStep = -1;
      lastStory = "";
      tick();
    };

    const stop = () => {
      const st = stage.current;
      if (!st) return;
      st.setAttribute("data-phase", "hero");
      st.setAttribute("data-step", "0");
      document.documentElement.removeAttribute("data-ground");
      document.documentElement.removeAttribute("data-story");
      for (const d of drift) d[0].style.removeProperty("--drift");
    };

    if (reduce.matches) {
      collect();
      stop();
      return;
    }

    collect();
    tick();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", apply);
    mobile.addEventListener("change", apply);
    reduce.addEventListener("change", apply);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", apply);
      mobile.removeEventListener("change", apply);
      reduce.removeEventListener("change", apply);
    };
  }, []);

  return (
    <div className="story" ref={outer}>
      <div className="story-stage" ref={stage} data-phase="hero" data-step="0">
        {children}
      </div>
    </div>
  );
}
