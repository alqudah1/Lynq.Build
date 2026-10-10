"use client";

import { useState } from "react";
import type { Bag } from "@/lib/types";
import ColourStudio from "./ColourStudio";
import TechnicalComparison from "./TechnicalComparison";

export default function ColourLab({ bags }: { bags: Bag[] }) {
  const [bagIdx, setBagIdx] = useState(0);
  const [view, setView] = useState<"studio" | "technical">("studio");
  const bag = bags[bagIdx];

  return (
    <div className="cl">
      <header className="at-top">
        <h1 className="at-title">
          Atelier <span className="at-title-note">Admin review</span>
        </h1>
        <nav className="at-bags" aria-label="Bag">
          {bags.map((b, i) => (
            <button key={b.slug} type="button" aria-pressed={i === bagIdx} className={i === bagIdx ? "is-on" : ""} onClick={() => setBagIdx(i)}>
              <span className="at-bag-n" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
              {b.name}
            </button>
          ))}
        </nav>
        <div className="at-views" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "studio"} className={view === "studio" ? "is-on" : ""} onClick={() => setView("studio")}>Studio</button>
          <button type="button" aria-pressed={view === "technical"} className={view === "technical" ? "is-on" : ""} onClick={() => setView("technical")}>Technical</button>
        </div>
      </header>
      {view === "studio" ? (
        <ColourStudio key={bag.slug} bag={bag} index={bagIdx} total={bags.length} />
      ) : (
        <TechnicalComparison key={bag.slug} bag={bag} />
      )}
    </div>
  );
}
