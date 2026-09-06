// /rand-product-photos — post-archive-audit state.
//
// History, so nobody re-adds what was deliberately removed: this route once
// held a 20+ item photo request (front / side / base / back across all four
// products, plus detail shots). Rand's Google Drive archive was then audited
// and found to already contain that evidence — dozens of professional DSC
// stills plus phone and professional video. The broad request is withdrawn
// permanently and parked at
// docs/3d-production/archive/RAND-PHOTO-REQUEST.superseded.txt (DO NOT SEND).
//
// DO NOT restore generic angle requests here. The governing rule is: do not
// ask Rand to recreate evidence merely because our internal mapping is
// incomplete. Only a question photography genuinely cannot answer belongs on
// this page.
//
// Unlinked from navigation, noindex. No database, no cart, no catalog, no 3D.
// Message + full reasoning: docs/3d-production/RAND-PHOTO-REQUEST.txt

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Arcubed — two quick questions",
  description: "Two questions for Rand. Everything else is already covered by the existing archive.",
  robots: { index: false, follow: false, nocache: true },
};

const SETTLED = [
  { product: "Vault", source: "DSC04876 sequence", covers: "Body shape and the built-in opening / handle", clear: true },
  { product: "Mini Luna", source: "DSC05774 sequence", covers: "Body shape, the arched handle, the metallic red", clear: true },
  { product: "Loco", source: "DSC05765 sequence", covers: "Body shape, the built-in opening, the fringe", clear: false },
  { product: "Nova", source: "Gold Nova photography", covers: "Body shape, the crochet, the metallic finish", clear: false },
];

const QUESTIONS = [
  {
    n: "1",
    product: "Nova",
    ask: "Is the handle part of every Nova, only certain Nova designs, or an optional / custom feature?",
    why: "This is the one thing photos can't tell us. A photo shows whether one bag has a handle — not whether every Nova is made that way.",
  },
  {
    n: "2",
    product: "Colours",
    ask: "If you have the actual manufacturer yarn colour codes, could you send them over?",
    why: "If you don't have them, that's completely fine — we'll work from the photos.",
  },
];

export default function RandProductPhotosPage() {
  return (
    <div className="rpp">
      <style>{CSS}</style>

      <header className="rpp-hero">
        <p className="rpp-eyebrow">Arcubed Label</p>
        <h1 className="rpp-title">Two quick questions — no new photos needed</h1>
        <p className="rpp-lede">
          We went through everything you&rsquo;ve already sent us, and it covers almost all of what
          we need to build the interactive versions of your bags. Just two things left that the
          photos can&rsquo;t tell us.
        </p>
      </header>

      <section className="rpp-questions">
        {QUESTIONS.map((q) => (
          <article className="rpp-q" key={q.n}>
            <span className="rpp-q-num">{q.n}</span>
            <div>
              <p className="rpp-q-product">{q.product}</p>
              <p className="rpp-q-ask">{q.ask}</p>
              <p className="rpp-q-why">{q.why}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="rpp-card">
        <h2 className="rpp-card-title">Everything else is already covered</h2>
        <p className="rpp-card-note">
          Your existing photos and videos gave us what we needed for all four bags.
        </p>
        <ul className="rpp-settled">
          {SETTLED.map((row) => (
            <li key={row.product}>
              <span className="rpp-settled-name">{row.product}</span>
              <span className="rpp-settled-covers">{row.covers}</span>
            </li>
          ))}
        </ul>
        <p className="rpp-body rpp-body-muted">
          The videos turned out to be especially useful — a clip of a bag being turned in your hand
          shows us more than a photo can.
        </p>
      </section>

      <section className="rpp-final">
        <p>
          <strong>Please don&rsquo;t reshoot anything.</strong> Nothing above needs replacing, and
          there&rsquo;s no photoshoot to arrange.
        </p>
      </section>

      <p className="rpp-signoff">Thank you, Rand — this is nearly there. 🤍</p>
    </div>
  );
}

const CSS = `
.rpp {
  --navy: #143562;
  --blush: #ffe0fd;
  max-width: 620px;
  margin: 0 auto;
  padding: 40px 20px 72px;
}
.rpp-hero { text-align: center; margin-bottom: 32px; }
.rpp-eyebrow {
  font-family: var(--font-body);
  font-size: 11px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--navy); opacity: 0.7; margin: 0 0 14px;
}
.rpp-title {
  font-family: var(--font-head); font-weight: 400;
  font-size: clamp(27px, 6.2vw, 38px); line-height: 1.16; letter-spacing: -0.02em;
  color: var(--navy); margin: 0 auto 16px; max-width: 17ch;
}
.rpp-lede {
  font-size: 16px; line-height: 1.6; color: #5c5751;
  margin: 0 auto; max-width: 47ch;
}

.rpp-questions { display: flex; flex-direction: column; gap: 14px; }
.rpp-q {
  display: flex; gap: 15px; align-items: flex-start;
  background: var(--blush); border-radius: var(--radius);
  padding: 22px 20px;
}
.rpp-q-num {
  flex: 0 0 auto;
  width: 27px; height: 27px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--navy); color: var(--blush);
  font-size: 13px; font-weight: 600;
}
.rpp-q-product {
  margin: 3px 0 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--navy); opacity: 0.65;
}
.rpp-q-ask {
  margin: 0; font-family: var(--font-head); font-size: 18px; line-height: 1.4;
  color: var(--navy);
}
.rpp-q-why { margin: 9px 0 0; font-size: 14px; line-height: 1.55; color: #4a453f; }

.rpp-card {
  margin-top: 18px;
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--radius); padding: 22px 20px;
}
.rpp-card-title {
  font-family: var(--font-head); font-weight: 500;
  font-size: 20px; letter-spacing: -0.01em; color: var(--navy); margin: 0;
}
.rpp-card-note { font-size: 14px; color: var(--muted); margin: 8px 0 0; }
.rpp-body { font-size: 15px; line-height: 1.6; color: #4a453f; margin: 14px 0 0; }
.rpp-body-muted { color: #6f665e; font-size: 14px; }

.rpp-settled { margin: 14px 0 0; padding: 0; list-style: none; }
.rpp-settled li {
  display: flex; gap: 12px; align-items: baseline;
  padding: 10px 0; border-top: 1px solid var(--line);
}
.rpp-settled li:first-child { border-top: 0; }
.rpp-settled-name {
  flex: 0 0 82px;
  font-size: 11px; font-weight: 600; letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--navy);
}
.rpp-settled-covers { font-size: 14.5px; line-height: 1.5; color: #4a453f; }

.rpp-final {
  margin-top: 18px; padding: 18px 20px;
  border: 1px dashed rgba(20, 53, 98, 0.28); border-radius: var(--radius);
  text-align: center;
}
.rpp-final p { margin: 0; font-size: 15px; line-height: 1.55; color: #4a453f; }
.rpp-final strong { color: var(--navy); font-weight: 600; }

.rpp-signoff {
  margin: 28px 0 0; text-align: center;
  font-family: var(--font-head); font-size: 16px; color: var(--navy); opacity: 0.85;
}
`;
