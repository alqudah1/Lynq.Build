# Arcubed — Motion & Art Direction

Applies `../../LYNQ_VISUAL_DIRECTION.md`'s standing standard specifically
to Arcubed. Read that document first — this one doesn't repeat the
research, only the reinterpretation. Companion to (not a replacement for)
`design-direction.md`, the earlier UX-flow document — that one describes
*what's on each page*; this one describes *how it looks and moves*.

## Arcubed's visual character

Premium, fashion/editorial, feminine without being childish, handmade,
artistic, photography-led. Navy (`#143562`) and pale pink (`#FFE0FD`) —
used as accents, never as a dominant fill. High-contrast typography
carrying real hierarchy. Large product imagery, intentional whitespace,
composition that's unexpected but restrained — never busy, never random.

## Product-first rule

**The bags are the art.** Every surface that shows a bag should frame it
like a fashion object being photographed for a lookbook, not a SKU in a
grid. Large crops, editorial asymmetry, close-up texture shots, full-bleed
photography, unexpected positioning, strong type, real negative space,
motion tied to *product interaction* specifically (a colour change, a
strap swap) rather than motion for its own sake.

## Applying the 4-step process to Arcubed's key surfaces

### Customizer — should feel like a fashion configurator, not a form

- **References:** Motion.dev's "Add to basket" feedback pattern and
  "Price switcher" dynamic-value display; 21st.dev's shared-element hover/
  selection transitions (the *mechanic* of a selected state morphing
  smoothly, not its neutral-card skin).
- **Principle:** state changes (colour, size, strap, chain) should read as
  the *same object continuously reconfiguring*, not a new screen replacing
  the old one — and the price should feel like it's responding to a real
  choice, not just re-rendering a number.
- **Reinterpretation for Arcubed:** the existing crossfade between bag
  states (`ProductGallery.tsx`'s `BagArtCrossfade`) already does the
  "same object reconfiguring" part correctly — keep it. What's missing is
  the `lively` emphasis moment on price change (a confirmed real option
  already exists: `PriceDisplay.tsx`'s `.pulse` class) and swatch selection
  feedback tuned to `snap`, not a generic hover — both already partially
  built; tightened as part of this pass (see below). The eventual 3D
  handoff (once a real GLB ships) should use a `gentle` cross-dissolve
  between the photography/BagArt fallback and the 3D canvas mounting, not
  an abrupt swap.

### Ready for Delivery — a curated drop, not a stock table

- **References:** Site of Sites' type-based, editorial grid compositions;
  Motion.dev's staggered grid reveal pattern (0.04s tight stagger for
  repeated small items) and "Image reveal slider" progressive-disclosure
  idea.
- **Principle:** availability itself can be part of the editorial story —
  "here's what's ready right now" reads as a curated, time-bound
  moment (a drop) rather than a permanent inventory listing, purely
  through typography, pacing, and restraint — no countdown timers, no
  "in stock" badges, nothing that reads as ecommerce urgency.
- **Reinterpretation for Arcubed:** built this pass — see below.

### Home — editorial sequence, not a stack of sections

Already reasonably aligned (per `design-direction.md`'s existing plan —
full-bleed hero, large signature-piece cards, a brand-statement band, an
Instagram grid). Not rebuilt this pass; flagged as the next candidate for
the 4-step process once real photography exists to art-direct against —
redesigning hero choreography around placeholder/BagArt imagery would be
solving the wrong problem before the real asset exists.

## What was actually built this pass

Following the 4-step process above, only the **Ready for Delivery empty
state and card presentation** were rebuilt this turn — a deliberately
narrow, low-risk scope rather than a full-site pass, since:

1. It's explicitly named in the standing brief as needing reinterpretation.
2. It's currently the thinnest surface on the site (a plain empty-state
   message), so there's real room to improve without risking a working
   flow.
3. It requires no real product photography to art-direct correctly —
   unlike Home's hero or the Shop grid, which are waiting on real Arcubed
   photography before a meaningful redesign pass makes sense.

See the change itself for the applied reinterpretation. Motion tokens used
(`--ease`, stagger timing, entrance distance) now follow the values in
`../../../LYNQ_VISUAL_DIRECTION.md`'s vocabulary table rather than ad hoc
numbers, so future sections build from the same system.

## Not done this pass, flagged for the next round

- Home hero and Shop grid choreography — waiting on real photography.
- Customizer's full swatch/strap/chain interaction polish beyond the price-
  pulse/snap tightening noted above — a larger, riskier surface to touch
  without a specific brief on which exact interactions to change.
- Introducing a dedicated motion library (e.g. `motion`, the npm package
  Motion.dev ships) instead of the current plain CSS transitions/
  `IntersectionObserver` pattern. The current site has zero JS animation
  dependency; CSS handles everything built this pass. A real dependency
  addition is a bigger, more consequential decision than a single visual
  section and wasn't made unprompted — flagged here for an explicit
  decision before the next round if shared-layout/spring-physics
  choreography (e.g. a true morphing customizer transition) is wanted.
