import { ShopGridSkeleton } from "@/components/CatalogLoadingState";

export default function ShopLoading() {
  return (
    <>
      <section className="section shop-head">
        <p className="eyebrow center">The Collection</p>
        <h1 className="center">Every bag, made to order.</h1>
      </section>
      <section className="section">
        <ShopGridSkeleton />
      </section>
    </>
  );
}
