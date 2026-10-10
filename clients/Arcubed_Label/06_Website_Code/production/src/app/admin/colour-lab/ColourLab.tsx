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
      <header className="cl-bar">
        <div className="cl-bar-title">
          <p className="cl-kicker">Arcubed · admin review</p>
          <h1 className="cl-title">Colour Studio</h1>
        </div>
        <nav className="cl-bags" aria-label="Bag">
          {bags.map((b, i) => (
            <button key={b.slug} type="button" aria-pressed={i === bagIdx} className={i === bagIdx ? "is-on" : ""} onClick={() => setBagIdx(i)}>
              {b.name}
            </button>
          ))}
        </nav>
        <div className="cl-views" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "studio"} className={view === "studio" ? "is-on" : ""} onClick={() => setView("studio")}>Studio</button>
          <button type="button" aria-pressed={view === "technical"} className={view === "technical" ? "is-on" : ""} onClick={() => setView("technical")}>Technical comparison</button>
        </div>
      </header>
      {view === "studio" ? <ColourStudio key={bag.slug} bag={bag} /> : <TechnicalComparison key={bag.slug} bag={bag} />}
    </div>
  );
}
