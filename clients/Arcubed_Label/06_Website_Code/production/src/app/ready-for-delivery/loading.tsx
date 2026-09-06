import { ShopGridSkeleton } from "@/components/CatalogLoadingState";

export default function ReadyForDeliveryLoading() {
  return (
    <>
      <section className="section shop-head">
        <p className="eyebrow center">Ready for Delivery</p>
        <h1 className="center">Already made.</h1>
      </section>
      <section className="section">
        <ShopGridSkeleton />
      </section>
    </>
  );
}
