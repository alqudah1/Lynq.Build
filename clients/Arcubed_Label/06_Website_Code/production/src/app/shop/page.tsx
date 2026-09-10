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

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Shop",
  description: "Every Arcubed colourway. Four hand-crocheted shapes, made to order in Jordan.",
};

export default async function ShopPage() {
  const bags = await getActiveBags();

  return (
    <>
      <section className="shopx-head">
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
      </section>

      {/* Shapes first, so the relationship between model and colour is the
          first thing the page states. */}
      <section className="shopx shopx-models">
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
