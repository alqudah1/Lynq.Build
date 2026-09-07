// DEV ONLY. Renders the hero headline in each candidate pairing at real hero
// scale so the choice is made from a screenshot, not from taste in code.
// 404s in production via src/proxy.ts.

export const metadata = { title: "Hero type test", robots: { index: false, follow: false } };

const OPTIONS = [
  {
    id: "A",
    name: "Bodoni Moda + Inter",
    note: "High contrast fashion masthead. Risk: reads classic luxury.",
    display: "var(--font-display)",
    sans: "var(--font-body)",
  },
  {
    id: "B",
    name: "Instrument Serif + Inter",
    note: "Modern editorial. Light, young, current.",
    display: "var(--font-instrument)",
    sans: "var(--font-body)",
  },
  {
    id: "C",
    name: "Playfair Display + Archivo",
    note: "Magazine serif with a grotesk. Familiar, warmer.",
    display: "var(--font-playfair)",
    sans: "var(--font-archivo)",
  },
];

export default function TypeTestPage() {
  return (
    <main style={{ background: "#fff" }}>
      {OPTIONS.map((o) => (
        <section key={o.id} className="tt">
          <p className="tt-label">
            {o.id}. {o.name} <em>{o.note}</em>
          </p>
          <div className="tt-stage" style={{ ["--d" as string]: o.display, ["--s" as string]: o.sans }}>
            <h2 className="tt-h">
              <span className="tt-1">Made</span>
              <span className="tt-2">Your</span>
              <span className="tt-3">Way.</span>
            </h2>
            <p className="tt-note">
              Hand crocheted bags
              <br />
              Made to order in Jordan
            </p>
            <span className="tt-cta">Explore the collection</span>
          </div>
        </section>
      ))}
    </main>
  );
}
