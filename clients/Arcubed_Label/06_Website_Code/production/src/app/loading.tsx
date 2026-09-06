// Homepage loading skeleton. Mirrors the editorial hero's shape (a tall
// colour field with a centred mass) rather than the old card layout, so the
// first paint doesn't jump to a different composition.

export default function Loading() {
  return (
    <div className="ed-hero" aria-busy="true" aria-label="Loading">
      <div className="ed-skel-block" />
    </div>
  );
}
