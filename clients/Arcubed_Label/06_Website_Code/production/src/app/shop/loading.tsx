import { ShopGridSkeleton } from "@/components/CatalogLoadingState";

export default function ShopLoading() {
  return (
    <>
      <section className="section shop-head">
        <p className="eyebrow center">The Collection</p>
        <p className="center skeleton-title">Every bag, made to order.</p>
      </section>
      <section className="section">
        <ShopGridSkeleton />
      </section>
    </>
  );
}
