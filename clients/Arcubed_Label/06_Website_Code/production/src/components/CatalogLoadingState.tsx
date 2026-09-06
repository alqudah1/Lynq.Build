// Shown by app/loading.tsx, app/shop/loading.tsx, and
// app/product/[slug]/loading.tsx while the async Server Component fetches
// from Supabase. A soft pulse in the site's own surface/line colours, not a
// generic grey skeleton library — matches the same rounded, warm language as
// .card-art/.media-frame elsewhere on the site.

export function ShopGridSkeleton() {
  return (
    <div className="grid" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div className="card" key={i}>
          <div className="card-art skeleton-pulse" />
          <div className="skeleton-line" style={{ width: "60%", height: 16, marginTop: 16 }} />
          <div className="skeleton-line" style={{ width: "35%", height: 12, marginTop: 8 }} />
        </div>
      ))}
    </div>
  );
}

export function ProductPageSkeleton() {
  return (
    <section className="product" aria-hidden="true">
      <div className="product-media">
        <div className="media-frame skeleton-pulse" />
      </div>
      <div className="product-panel">
        <div className="skeleton-line" style={{ width: "40%", height: 12 }} />
        <div className="skeleton-line" style={{ width: "60%", height: 30, marginTop: 12 }} />
        <div className="skeleton-line" style={{ width: "20%", height: 24, marginTop: 20, marginBottom: 30 }} />
        <div className="skeleton-line" style={{ width: "25%", height: 11, marginBottom: 14 }} />
        <div style={{ display: "flex", gap: 14 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div className="skeleton-pulse" key={i} style={{ width: 42, height: 42, borderRadius: "50%" }} />
          ))}
        </div>
      </div>
    </section>
  );
}

export function HomeHeroSkeleton() {
  return (
    <section className="hero" aria-hidden="true">
      <div className="hero-art skeleton-pulse" />
      <div className="hero-copy">
        <div className="skeleton-line" style={{ width: "50%", height: 11 }} />
        <div className="skeleton-line" style={{ width: "80%", height: 40, marginTop: 12, marginBottom: 28 }} />
      </div>
    </section>
  );
}
