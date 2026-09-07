import { ShopGridSkeleton } from "@/components/CatalogLoadingState";

export default function ReadyForDeliveryLoading() {
  return (
    <>
      <section className="section shop-head">
        <p className="eyebrow center">Ready for Delivery</p>
        <p className="center skeleton-title">Already made.</p>
      </section>
      <section className="section">
        <ShopGridSkeleton />
      </section>
    </>
  );
}
