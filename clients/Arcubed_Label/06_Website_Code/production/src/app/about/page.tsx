// Placeholder brand copy — only reuses lines already established in the approved
// prototype/design direction (development-plan.md, design-direction.md). No founder
// story, dates, or specifics are invented here; replace with Arcubed's real story
// once Rand supplies it.
//
// The BagArt panel below is the same honest "no real image yet" placeholder
// used everywhere else on the site (see BagArt.tsx) — added purely so this
// page doesn't read as an unfinished blank column next to Home/Shop/Product,
// not as new content or an invented visual.

import BagArt from "@/components/BagArt";

export default function AboutPage() {
  return (
    <section className="hero">
      <div className="hero-art">
        <BagArt input={{ name: "Arcubed", colourHex: null }} />
      </div>
      <div className="hero-copy">
        <div className="page-head">
          <p className="eyebrow">About</p>
          <h1>Handmade, in small batches.</h1>
        </div>
        <div className="page-copy">
          <p>
            Every piece is crocheted by hand, one stitch at a time — no two are exactly
            alike. Each bag is made to order, built around the colours, straps and
            details you choose.
          </p>
          <p className="muted">
            (Placeholder copy — brand story, founding details and photography pending
            from Arcubed Label.)
          </p>
        </div>
      </div>
    </section>
  );
}
