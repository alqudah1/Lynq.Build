// Shop — the colourway wall.
//
// Every verified product/colour pairing, each tile carrying its own colour in
// the link (src/lib/variant.ts) so the product page opens on the colourway the
// customer actually clicked. Frame proportions follow a fixed catalogue
// rhythm (SHOP_RHYTHM), never masonry.

import Image from "next/image";
import { getActiveBags } from "@/lib/repository";
import { framesForColour, tileSrc, altFor } from "@/lib/product-media";
import CollectionGrid from "@/components/CollectionGrid";
import ModelCollection from "@/components/ModelCollection";
import ShopDiscovery from "@/components/ShopDiscovery";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Shop",
  description: "Every Arcubed colourway. Four hand-crocheted shapes, made to order in Jordan.",
};

/**
 * The one image that opens the shop.
 *
 * Rose Gold Nova was chosen here earlier for a reason that did not survive
 * contact with the page: it is a colourway the customer has not seen yet. At
 * opener scale it is a warm metallic cut-out on a pale pink field, which is
 * the lowest-contrast pairing in the archive, and the matte artefacts along
 * the handle and the right edge are plainly visible once the object is 700px
 * wide.
 *
 * Compared at full size against the alternatives:
 *   Nova Black      the strongest cut-out pairing, but it is already the
 *                   feature tile further down this same page
 *   Vault Olive     clean and well grounded, but it is the focal object of
 *                   the homepage closing frame
 *   Mini Luna Red   striking, and it is the homepage hero
 *   Loco Brown      a PHOTOGRAPH, not a cut-out, so there is no matte to fail
 *                   at scale; the fringe is the most distinctive texture the
 *                   brand owns and nothing else on the site is close to it
 *
 * Loco. It is the one object that gets better the larger it is printed, and
 * it opens the collection on something the homepage never shows.
 */
const ENTRY_CAST: ReadonlyArray<readonly [string, string]> = [
  ["loco", "Brown"],
  ["vault", "Olive Green"],
  ["nova", "Black"],
  ["mini luna", "Red"],
];

export default async function ShopPage() {
  const bags = await getActiveBags();

  const entry = (() => {
    for (const [name, colour] of ENTRY_CAST) {
      const bag = bags.find((b) => b.name.trim().toLowerCase() === name);
      const frame = bag ? framesForColour(bag, colour)[0] : undefined;
      if (bag && frame) return { bag, colour, frame };
    }
    return null;
  })();

  return (
    <>
      {/* The entry was a type-only poster: a full-width Bodoni slab on pink
          with no product on it, and it was the third near-identical giant
          serif opener in the journey (hero, here, about). It is a composition
          now — the claim on the left, one real bag cropped by the right edge
          — so the shop opens on a product rather than on a headline. */}
      <section className={`shopx-head${entry ? " has-object" : ""}`}>
        <div className="shopx-head-copy">
          <p className="shopx-kicker">Shop</p>
          <h1 className="shopx-title">
            Every colour
            <br />
            we have made.
          </h1>
          <p className="shopx-sub">
            Pick your shape.
            <br />
            Choose your colour.
            <br />
            Make it yours.
          </p>
        </div>
        {entry ? (
          <figure className="shopx-head-object">
            <Image
              src={tileSrc(entry.frame)}
              alt={altFor(entry.bag, entry.colour)}
              width={1400}
              height={Math.round(1400 / entry.frame.ratio)}
              // The opener bleeds edge to edge below 861 and fills the
              // 54fr column above it. 86vw under-declared the mobile band by
              // a whole gutter: measured a 1.16 upscale at 375 and 768.
              sizes="(max-width: 860px) 100vw, 56vw"
              preload
            />
          </figure>
        ) : null}
      </section>

      {/* Shapes first, so the relationship between model and colour is the
          first thing the page states.

          The heading is not decoration. This section had none, so the page ran
          entry -> four products -> "Every colourway" -> sixteen products, and
          the second half read as the first half repeated rather than as a
          different way in. Naming both halves is what makes it two deliberate
          routes: by shape, or by colour. */}
      <section className="shopx shopx-models">
        <div className="shopx-preview-head">
          <h2 className="shopx-kicker">Four shapes</h2>
          <p className="shopx-headnote">Every colour each one comes in</p>
        </div>
        <ModelCollection bags={bags} />
      </section>

      {/* Then the full wall, which is the colour of this brand and stays.
          Grouping alone would have turned the store into four category boxes. */}
      <section className="shopx">
        <div className="shopx-preview-head">
          <h2 className="shopx-kicker">Every colourway</h2>
        </div>
        <ShopDiscovery>
          <CollectionGrid bags={bags} />
        </ShopDiscovery>
      </section>
    </>
  );
}
