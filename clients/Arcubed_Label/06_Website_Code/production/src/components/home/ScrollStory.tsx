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

    // THE RENDERED STATE IS ITS OWN VARIABLE, NOT A READING OF scrollY.
    //
    // Capping the scroll position is the right mechanism but it cannot be a
    // guarantee on its own: the cap is a main-thread reaction to a
    // compositor-driven fling, and if a single scroll event is delivered
    // late or coalesced, the position is already past and the render follows
    // it. Measured over 588 synthesized gestures, that leaked about three
    // times — always as a modest swipe that had picked up momentum.
    //
    // What the customer is promised is about what they SEE, so the promise
    // is kept where the rendering is decided. `committed` moves by at most
    // one per gesture by construction, and the scroll cap keeps the page
    // position agreeing with it. A late scroll event can now make the page
    // briefly out of position; it can no longer make the story skip a state.
    let committed = 0;
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
      // Land the page inside the band the story is actually showing, so
      // position and state agree at rest and the next gesture starts from a
      // truthful place.
      const travel = storyH - window.innerHeight;
      if (travel > 0) {
        const lo = docTop + bounds[committed] * travel;
        const hi = docTop + (committed + 1 < bounds.length ? bounds[committed + 1] : 1) * travel;
        if (window.scrollY < lo - 1 || window.scrollY >= hi) window.scrollTo(0, Math.round(lo) + 1);
      }
      thaw();
      anchor = -1;
      byTouch = false;
    };
    const armSettle = () => {
      if (settle) clearTimeout(settle);
      settle = window.setTimeout(endGesture, SETTLE_MS);
    };
    const beginGesture = (touch: boolean) => {
      if (anchor < 0) {
        // Anchored on what is RENDERED, which is the only state the person
        // making the gesture can see.
        anchor = committed;
        byTouch = touch;
      }
      armSettle();
    };
    const onTouchStart = () => { thaw(); touching = true; beginGesture(true); };
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
    /**
     * Apply the gesture clamp. Returns the corrected progress, or -1 when
     * no correction was needed.
     *
     * Called SYNCHRONOUSLY from the scroll listener as well as from the
     * tick. Running only in the rAF tick meant reacting a frame late, and a
     * frame is a long time on a busy main thread: over the network, with
     * images still decoding, a 430 flick got two states ahead before the
     * first correction ran. This is nine comparisons and an occasional
     * scrollTo — nothing like the per-frame style invalidation this file
     * exists to avoid.
     */
    const clamp = () => {
      if (anchor < 0) return -1;
      const travel = storyH - window.innerHeight;
      if (travel <= 0) return -1;
      const p = progress();
      const raw = stateAt(p);
      const limit = raw > anchor + 1 ? anchor + 1 : raw < anchor - 1 ? anchor - 1 : -1;
      if (limit < 0) return -1;
      // +1px so the landing sits INSIDE the band rather than exactly on its
      // edge, where a sub-pixel scroll position reads as the state before it.
      const target = Math.round(docTop + bounds[limit] * travel) + 1;
      capScroll(target);
      return Math.min(1, Math.max(0, (target - docTop) / travel));
    };

    // HOLD THE FREEZE UNTIL THE FLING IS ACTUALLY DEAD.
    //
    // Releasing overflow on the next animation frame was not enough: the
    // fling is often still live at that point and simply resumes, which is
    // how one gesture in eighty-four still reached state 2 across repeated
    // runs. The document stays frozen until the gesture SETTLES — at most
    // SETTLE_MS, and only after the page has stopped producing scroll events
    // — so there is no momentum left to resume. A new touch thaws it
    // immediately, so a finger can always scroll.
    //
    // Touch only. On a desktop this would remove the scrollbar and shift the
    // layout by its width; wheel gestures carry little momentum and the
    // scrollTo alone holds them.
    let frozen = false;
    const thaw = () => {
      if (!frozen) return;
      frozen = false;
      document.documentElement.style.overflowY = "";
    };
    const capScroll = (target: number) => {
      if (Math.abs(window.scrollY - target) <= 1) return;
      // Freezing stops scroll events, and the settle timer is driven by
      // scroll events — so without re-arming here the gesture would be
      // declared over during its own correction, releasing the anchor just
      // before the fling resumed. Measured: a 600px swipe from state 2
      // reaching state 4 that way.
      armSettle();
      if (byTouch && !frozen) {
        frozen = true;
        document.documentElement.style.overflowY = "hidden";
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
      const capped = clamp();
      if (capped >= 0) p = capped;

      // COMMIT AT MOST ONE STATE PER GESTURE. The scroll cap above keeps the
      // page where it should be; this keeps the RENDER right even on the
      // frame where a late scroll event says otherwise.
      const raw = stateAt(p);
      committed =
        anchor >= 0
          ? raw > anchor + 1
            ? anchor + 1
            : raw < anchor - 1
              ? anchor - 1
              : raw
          : raw;

      // Which composition is on screen — read from the committed state, not
      // from the raw progress.
      const phase = stateBand[committed];
      let i = 0;
      for (let k = 0; k < bands.length; k++) if (bands[k][0] === phase) i = k;
      const start = bands[i][1];
      const end = i + 1 < bands.length ? bands[i + 1][1] : 1;
      // `within` still tracks the real scroll position: it only drives the
      // drift on three leaf elements, where following the finger is the
      // point, and clamping it would make the page feel dead mid-state.
      const within = end > start ? Math.min(1, Math.max(0, (p - start) / (end - start))) : 0;

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
      const story =
        committed >= bounds.length - 1 && p >= 0.995
          ? "done"
          : committed > 0 || p > 0.04
            ? "running"
            : "hero";
      if (story !== lastStory) {
        lastStory = story;
        document.documentElement.setAttribute("data-story", story);
      }

      // Which colourway. Discrete on purpose: the customer sees a colour, a
      // transition, then the next colour, instead of five images dissolving
      // through each other while one swipe is still in progress.
      const step =
        phase === "cust"
          ? stateStep[committed]
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
      // Correct on the event itself. Waiting for the frame lets a fast
      // fling travel a whole extra state before anything reacts.
      clamp();
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
      anchor = -1;
      committed = stateAt(progress());
      tick();
    };

    const stop = () => {
      const st = stage.current;
      if (!st) return;
      committed = 0;
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
    committed = stateAt(progress());
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
