import { getActiveBags } from "@/lib/repository";
import ProductGrid from "@/components/ProductGrid";

// Live catalog data should never be prerendered — see app/page.tsx for why
// this must be explicit rather than inferred.
export const dynamic = "force-dynamic";

export default async function ShopPage() {
  const bags = await getActiveBags();
  return (
    <>
      <section className="section shop-head">
        <p className="eyebrow center">The Collection</p>
        <h1 className="center">Every bag, made to order.</h1>
      </section>
      <section className="section">
        <ProductGrid bags={bags} />
      </section>
    </>
  );
}
