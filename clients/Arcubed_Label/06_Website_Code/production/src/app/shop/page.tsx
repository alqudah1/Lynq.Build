// Shop — the colourway wall.
//
// Every verified product/colour pairing, each tile carrying its own colour in
// the link (src/lib/variant.ts) so the product page opens on the colourway the
// customer actually clicked. Frame proportions follow a fixed catalogue
// rhythm (SHOP_RHYTHM), never masonry.

import { getActiveBags } from "@/lib/repository";
import CollectionGrid from "@/components/CollectionGrid";
import ModelCollection from "@/components/ModelCollection";
import ShopDiscovery from "@/components/ShopDiscovery";
import ColourwayReveal from "@/components/ColourwayReveal";
import { COLLECTION } from "@/lib/collection";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Shop",
  description: "Every Arcubed colourway. Four hand-crocheted shapes, made to order in Jordan.",
};

/* THE SHOP OPENS ON THE PRODUCTS, NOT ON A POSTER OF ONE.
 *
 * There was a single large photograph here — Loco in Brown, chosen because
 * the fringe is the most distinctive texture the brand owns. On the page it
 * did the opposite of what it was picked for: a dark brown mass directly
 * under a pale pink intro, heavy and murky, and on a phone it was 244px of it
 * before the customer reached a single product they could buy.
 *
 * Nothing replaces it. Three real products sit immediately below this
 * section, each on its own field, so an opener image was showing a fourth bag
 * within the same screen as the three that matter — and any clean candidate
 * (Nova, Mini Luna, Vault) is one of those three, or the homepage hero.
 * Removing it puts the first model 218px sooner on a phone and lets the pink
 * intro be what it always was: a short editorial band. */


export default async function ShopPage() {
  const bags = await getActiveBags();

  return (
    <>
      <section className="shopx-head">
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
          {/* "Every colour each one comes in" read as a fragment with its
              subject missing. This says what the section is for. */}
          <p className="shopx-headnote">
            Choose your shape.
            <br />
            Then make it yours.
          </p>
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
          <ColourwayReveal total={COLLECTION.length}>
            <CollectionGrid bags={bags} />
          </ColourwayReveal>
        </ShopDiscovery>
      </section>
    </>
  );
}
