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

    // THE PAGE IS NEVER MOVED BY SCRIPT.
    //
    // The previous version (f704d31) tried to guarantee "one gesture, one
    // state" by capping scrollY and freezing the document with
    // overflow:hidden until a fling died, then landing the page back inside
    // whichever state was showing. The client reported exactly what that
    // does on a real phone and a real trackpad, and it reproduced on the
    // first try:
    //
    //   - scroll past "Made yours." and the page is dragged back up to it:
    //     1130px on a phone swipe, 431px on six wheel notches at 1440
    //   - the freeze is felt as the story not scrolling smoothly
    //   - scrolling through the colours "sends us up", because every capped
    //     frame moves the page against the finger
    //
    // A scroll-driven story cannot hold the page still AND let the reader
    // leave it. So the promise moves to where it belongs, the RENDER: scroll
    // is native and untouched, and the state that is SHOWN follows the state
    // the scroll position asks for one step at a time. A fling across five
    // colourways plays all five in quick succession instead of jumping from
    // the first to the last, and a normal swipe that crosses one boundary
    // changes state immediately, exactly as before.
    //
    // BOUNDS is every state boundary as a progress value, the five colourway
    // sub-steps included, derived from the same bands the tick reads so the
    // two cannot drift apart.
    let bounds: number[] = [];
    /** Which band each state belongs to, and which colourway inside it. */
    let stateBand: string[] = [];
    let stateStep: number[] = [];
    const rebuildBounds = () => {
      bounds = [];
      stateBand = [];
      stateStep = [];
      for (let k = 0; k < bands.length; k++) {
        const start = bands[k][1];
        const end = k + 1 < bands.length ? bands[k + 1][1] : 1;
        if (bands[k][0] === "cust") {
          for (let s = 0; s < CUST_STEPS; s++) {
            bounds.push(start + ((end - start) * s) / CUST_STEPS);
            stateBand.push("cust");
            stateStep.push(s);
          }
        } else {
          bounds.push(start);
          stateBand.push(bands[k][0]);
          stateStep.push(0);
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

    /** The state on screen. Moves toward `target` by one, never more. */
    let committed = 0;
    /** The state the scroll position asks for. */
    let target = 0;
    let lastStepAt = -Infinity;
    let chase = 0;
    // Long enough that each state visibly lands before the next begins, so a
    // fling reads as a quick sequence and not as a flash; short enough that
    // catching up across all nine states takes under three seconds. The
    // transitions themselves are unchanged (--t / --tc in home.css).
    const STEP_MS = 300;

    // WARM THE LATE IMAGES ON THE FIRST SCROLL.
    //
    // The five "Make it yours" photographs and the "Made yours." object are
    // lazy, and they sit inside phases clipped shut until reached, so the
    // browser did not request them until the phase opened: measured on the
    // alias, not one of the five had downloaded while the story was on the
    // shape phase. On a phone that arrival is an empty stage. They are asked
    // for the moment the reader first scrolls, which is after the hero (the
    // LCP) has painted and long before either phase can be reached.
    let warmed = false;
    const warm = () => {
      if (warmed) return;
      warmed = true;
      stage.current
        ?.querySelectorAll<HTMLImageElement>(".phase-cust img, .phase-final img")
        .forEach((img) => { img.loading = "eager"; });
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

    /** Write the committed state. Attributes only change when they differ. */
    const render = (p: number) => {
      const st = stage.current;
      if (!st) return;
      const phase = stateBand[committed];
      let i = 0;
      for (let k = 0; k < bands.length; k++) if (bands[k][0] === phase) i = k;
      const start = bands[i][1];
      const end = i + 1 < bands.length ? bands[i + 1][1] : 1;
      // `within` tracks the real scroll position: it only drives the drift on
      // three leaf elements, where following the finger is the point.
      const within = end > start ? Math.min(1, Math.max(0, (p - start) / (end - start))) : 0;

      if (phase !== lastPhase) {
        lastPhase = phase;
        st.setAttribute("data-phase", phase);
        // Every phase is in the DOM at once and the hidden ones are only
        // clipped, so their links (the shapes, the colour rail) were still in
        // the tab order: a keyboard user could land on something invisible.
        // Only the phase on screen is interactive.
        st.querySelectorAll<HTMLElement>(":scope > .phase").forEach((el) => {
          el.inert = !el.classList.contains(`phase-${phase}`);
        });
        // The header sits over navy for exactly one phase, and navy needs the
        // pink wordmark. Derived from the phase rather than from a hardcoded
        // progress value, so it cannot drift out of step with the bands.
        document.documentElement.setAttribute(
          "data-ground",
          phase === "shape" ? "navy" : "light"
        );
      }

      // Which colourway. Discrete on purpose: the customer sees a colour, a
      // transition, then the next colour, instead of five images dissolving
      // through each other while one swipe is still in progress.
      const step =
        phase === "cust" ? stateStep[committed] : phase === "final" ? CUST_STEPS - 1 : 0;
      if (step !== lastStep) {
        lastStep = step;
        st.setAttribute("data-step", String(step));
      }

      // The only per-frame writes left, and they land on leaf elements.
      // Eased so the drift is strongest mid-phase and settles at both ends,
      // which stops it fighting the transition running at a boundary.
      //
      // QUANTISED, because a custom property write is a style invalidation
      // however small the change is. Rounded to a tenth of a vh the value
      // only actually changes a few dozen times per phase.
      const ease = Math.sin(within * Math.PI);
      for (const d of drift) {
        const v = Math.round(ease * d[1] * 10) / 10;
        if (v !== d[2]) {
          d[2] = v;
          d[0].style.setProperty("--drift", v + "vh");
        }
      }
    };

    /** Step the shown state one place toward the target, then wait. */
    const advance = () => {
      chase = 0;
      if (committed === target) return;
      const wait = STEP_MS - (performance.now() - lastStepAt);
      if (wait > 0) {
        chase = window.setTimeout(advance, wait);
        return;
      }
      committed += target > committed ? 1 : -1;
      lastStepAt = performance.now();
      render(progress());
      if (committed !== target) chase = window.setTimeout(advance, STEP_MS);
    };

    const tick = () => {
      raf = 0;
      if (!outer.current || !stage.current) return;
      const p = progress();
      target = stateAt(p);
      if (p > 0.02) warm();

      // Drives the header, which lives outside this component. It follows
      // the REAL position, not the shown state: a reader who has scrolled
      // into the collection must get the header back even while the story
      // is still stepping through its last states off screen.
      const story = p >= 0.995 ? "done" : p > 0.04 ? "running" : "hero";
      if (story !== lastStory) {
        lastStory = story;
        document.documentElement.setAttribute("data-story", story);
      }

      if (target !== committed && !chase) advance();
      render(p);
    };

    const onScroll = () => {
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
      // A resize or orientation change is not a gesture: show where the
      // reader actually is rather than walking there.
      if (chase) clearTimeout(chase);
      chase = 0;
      committed = target = stateAt(progress());
      tick();
    };

    const stop = () => {
      const st = stage.current;
      if (!st) return;
      committed = target = 0;
      // Reduced motion lays every phase out as a plain document, so all of
      // them are readable and all of them must be reachable.
      st.querySelectorAll<HTMLElement>(":scope > .phase").forEach((el) => { el.inert = false; });
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
    // A reload mid-page lands on the right state immediately.
    committed = target = stateAt(progress());
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
    window.addEventListener("resize", apply);
    mobile.addEventListener("change", apply);
    reduce.addEventListener("change", apply);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (chase) clearTimeout(chase);
      ro.disconnect();
      window.removeEventListener("load", onLoad);
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
