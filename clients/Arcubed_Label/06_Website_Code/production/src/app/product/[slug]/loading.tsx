// Streaming placeholder for a product page: the Colour Atelier's own geometry
// (the pink set where the bag goes, the panel beside or beneath it), at least
// a screen tall. The page replaces it without anything moving, and the footer
// never flashes into view first (it did with the old, shorter skeleton: a
// layout shift on every product page).
export default function ProductLoading() {
  return (
    <div className="cl at-shop at-skel" aria-busy="true" aria-label="Loading">
      <div className="at">
        <div className="at-media"><div className="at-stage"><div className="at-set" /></div></div>
        <div className="at-rail" aria-hidden="true">
          <div className="at-skel-line" style={{ width: "46%", height: 46 }} />
          <div className="at-skel-line" style={{ width: "34%", height: 12, marginTop: 18 }} />
          <div className="at-skel-dots">{[0, 1, 2, 3, 4].map((i) => <span key={i} />)}</div>
        </div>
      </div>
    </div>
  );
}
