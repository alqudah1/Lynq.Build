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

    // GEOMETRY IS CACHED, NOT READ EVERY FRAME.
    //
    // The tick used to call getBoundingClientRect() on the container on every
    // animation frame purely to work out how far through the story we are.
    // For a statically positioned element that rect is just its document
    // offset minus the scroll position, so the offset can be measured once and
    // the scroll position read from window.scrollY, which costs nothing.
    //
    // What is NOT cached is innerHeight. On a phone the viewport changes
    // height as the browser chrome collapses, and travel depends on it, so it
    // is read live each frame; that is a plain property read and forces no
    // layout. A ResizeObserver re-measures if the container itself changes
    // size, which covers fonts landing, images settling and orientation
    // changes without trusting any single event to fire.
    let docTop = 0;
    let storyH = 0;
    const measure = () => {
      const el = outer.current;
      if (!el) return;
      docTop = el.getBoundingClientRect().top + window.scrollY;
      storyH = el.offsetHeight;
    };

    // ONE GESTURE, ONE STATE.
    //
    // Every state here is derived from scroll POSITION, so the story had no
    // concept of a gesture: a flick is just a large change in scrollY, and
    // the tick read whatever state that landed on. Measured at 390x844,
    // where the travel is 3376px across nine states — the colour sequence
    // alone is 270px per colourway, well under one thumb flick:
    //
    //   small swipe        state 0 -> 0
    //   medium swipe       state 0 -> 1
    //   large swipe        state 0 -> 4
    //   very large swipe   state 0 -> 8    the whole story in one gesture
    //   fast flick         state 0 -> 8
    //   slow long drag     state 0 -> 4
    //
    // This is an input clamp and nothing else. No transition is slower, no
    // gesture needs more travel, and a swipe that crosses at most one
    // boundary never reaches this code.
    //
    // WHY NOT CSS SCROLL SNAP. `scroll-snap-stop: always` is the platform
    // feature for this and it was my first choice. Driven with real
    // synthesized touch flings it did not hold: 69 of 84 gestures still
    // crossed multiple states, and `proximity` snapping also made ordinary
    // swipes stall. It cannot be shipped on a promise it does not keep.
    //
    // BOUNDS is every state boundary as a progress value, the five colourway
    // sub-steps included, derived from the same bands the tick reads so the
    // two cannot drift apart.
    let bounds: number[] = [];
    const rebuildBounds = () => {
      bounds = [];
      for (let k = 0; k < bands.length; k++) {
        const start = bands[k][1];
        const end = k + 1 < bands.length ? bands[k + 1][1] : 1;
        if (bands[k][0] === "cust") {
          for (let s = 0; s < CUST_STEPS; s++) bounds.push(start + ((end - start) * s) / CUST_STEPS);
        } else {
          bounds.push(start);
        }
      }
    };
    const progress = () => {
      const travel = storyH - window.innerHeight;
      return travel <= 0 ? 0 : Math.min(1, Math.max(0, (window.scrollY - docTop) / travel));
    };
    const stateAt = (p: number) => {
      let i = 0;
      for (let k = 0; k < bounds.length; k++) if (p >= bounds[k]) i = k;
      return i;
    };

    /** The state the gesture in flight started on, or -1 when none is. */
    let anchor = -1;
    let touching = false;
    let byTouch = false;
    let settle = 0;
    // Momentum keeps firing scroll events long after the finger is gone, so
    // a gesture is not over at touchend — it is over when the page stops
    // moving. Anything shorter re-anchors mid-fling and releases the clamp
    // at exactly the moment it is still needed.
    const SETTLE_MS = 140;

    const endGesture = () => {
      settle = 0;
      if (touching) return;
      anchor = -1;
      byTouch = false;
    };
    const armSettle = () => {
      if (settle) clearTimeout(settle);
      settle = window.setTimeout(endGesture, SETTLE_MS);
    };
    const beginGesture = (touch: boolean) => {
      if (anchor < 0) {
        anchor = stateAt(progress());
        byTouch = touch;
      }
      armSettle();
    };
    const onTouchStart = () => { touching = true; beginGesture(true); };
    const onTouchEnd = () => { touching = false; armSettle(); };
    const onWheel = () => { beginGesture(false); };

    // CANCEL THE FLING, DO NOT FIGHT IT.
    //
    // The first version of this just called scrollTo() whenever the state
    // ran past its limit. A fling runs on the COMPOSITOR and scrollTo runs
    // on the main thread, so the two fought: traced at 375 on a 12000px/s
    // flick, the page oscillated between y=650 and y=1295 twenty-six times
    // over 600ms, and the flick still escaped to state 3 once.
    //
    // Making the document briefly unscrollable ends the fling outright, so
    // the correction lands once and stays. One frame of overflow:hidden is
    // invisible on a phone, which has no scrollbar to remove — and it is
    // applied for touch gestures only, because on a desktop it would take
    // the scrollbar away and shift the layout by its width.
    let unlock = 0;
    const capScroll = (target: number) => {
      if (Math.abs(window.scrollY - target) <= 1) return;
      // Freezing the document stops scroll events, and the settle timer is
      // driven by scroll events — so without this the gesture could be
      // declared over DURING its own correction, releasing the anchor just
      // before the fling resumed. Measured: a 600px swipe from state 2
      // reaching state 4 that way.
      armSettle();
      const root = document.documentElement;
      if (byTouch) {
        root.style.overflowY = "hidden";
        if (unlock) cancelAnimationFrame(unlock);
        unlock = requestAnimationFrame(() => {
          unlock = 0;
          root.style.overflowY = "";
        });
      }
      window.scrollTo(0, target);
    };

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

      const travel = storyH - window.innerHeight;
      let p =
        travel <= 0
          ? 0
          : Math.min(1, Math.max(0, (window.scrollY - docTop) / travel));

      // THE CLAMP. While a gesture is in flight the story may move one state
      // from where that gesture began, and the scroll position is capped at
      // that boundary so position and state cannot disagree — clamping the
      // state alone would only defer the skip to the moment the clamp
      // released. Outside the story p is pinned at 0 or 1, the state stops
      // changing, and the rest of the page scrolls untouched.
      if (anchor >= 0 && travel > 0) {
        const raw = stateAt(p);
        const limit = raw > anchor + 1 ? anchor + 1 : raw < anchor - 1 ? anchor - 1 : -1;
        if (limit >= 0) {
          // +1px so the landing sits INSIDE the band rather than exactly on
          // its edge, where a sub-pixel scroll position reads as the state
          // before it.
          const target = Math.round(docTop + bounds[limit] * travel) + 1;
          capScroll(target);
          p = Math.min(1, Math.max(0, (target - docTop) / travel));
        }
      }

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
      // Momentum fires this long after touchend, so a live gesture stays
      // live until the page is genuinely still.
      if (anchor >= 0) armSettle();
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const apply = () => {
      bands = mobile.matches ? MOBILE_BANDS : DESKTOP_BANDS;
      rebuildBounds();
      collect();
      measure();
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

    rebuildBounds();
    collect();
    measure();
    tick();

    // Re-measure whenever the container's own box changes: fonts landing,
    // images settling, an orientation change, the address bar collapsing.
    const ro = new ResizeObserver(() => {
      measure();
      onScroll();
    });
    if (outer.current) ro.observe(outer.current);
    // One more after load, for anything that settles without resizing the
    // container itself.
    const onLoad = () => { measure(); onScroll(); };
    window.addEventListener("load", onLoad);
    window.addEventListener("scroll", onScroll, { passive: true });
    // All passive: none of these call preventDefault, they only observe that
    // a gesture has begun, so they must not sit on the critical path of the
    // scroll they are watching.
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("resize", apply);
    mobile.addEventListener("change", apply);
    reduce.addEventListener("change", apply);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (settle) clearTimeout(settle);
      if (unlock) cancelAnimationFrame(unlock);
      document.documentElement.style.overflowY = "";
      ro.disconnect();
      window.removeEventListener("load", onLoad);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("wheel", onWheel);
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
