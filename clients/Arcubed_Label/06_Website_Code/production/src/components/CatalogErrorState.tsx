"use client";

// Shown by app/error.tsx, app/shop/error.tsx, and app/product/[slug]/error.tsx
// whenever the catalog can't be read (see lib/repository.ts's
// CatalogUnavailableError). Deliberately styled like the rest of the site —
// warm background, Fraunces heading, one calm sentence — not a generic red
// error box. The message stays simple and non-technical on purpose; the real
// diagnostic detail already went to the server log (lib/logger.ts) before
// this ever rendered.

export default function CatalogErrorState({ reset }: { reset?: () => void }) {
  return (
    <section className="section empty-state">
      <p className="eyebrow center">Arcubed Label</p>
      <h2 className="center">We&rsquo;re having trouble loading the shop right now.</h2>
      <p className="page-copy center" style={{ margin: "0 auto 30px" }}>
        Please try again in a moment.
      </p>
      {reset ? (
        <div className="center">
          <button className="btn btn-primary" type="button" onClick={reset}>
            Try Again
          </button>
        </div>
      ) : null}
    </section>
  );
}
