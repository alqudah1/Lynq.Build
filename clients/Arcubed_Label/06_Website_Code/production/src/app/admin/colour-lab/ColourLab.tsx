"use client";

import { useState } from "react";
import Link from "next/link";
import type { Bag } from "@/lib/types";
import Atelier from "@/components/atelier/Atelier";
import TechnicalComparison from "./TechnicalComparison";

export default function ColourLab({ bags, productionTime }: { bags: Bag[]; productionTime: string | null }) {
  const [bagIdx, setBagIdx] = useState(0);
  const [view, setView] = useState<"studio" | "technical">("studio");
  const bag = bags[bagIdx];

  return (
    <div className="cl">
      <header className="at-top">
        <nav className="at-crumbs" aria-label="Breadcrumb">
          <Link href="/admin">Admin</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Colour Studio</span>
        </nav>
        {/* Not in the reference (which shows one bag): the studio covers all
            four, so the bag is chosen here, as quietly as the breadcrumb. */}
        <nav className="at-bags" aria-label="Bag">
          {bags.map((b, i) => (
            <button key={b.slug} type="button" aria-pressed={i === bagIdx} className={i === bagIdx ? "is-on" : ""} onClick={() => setBagIdx(i)}>
              {b.name}
            </button>
          ))}
        </nav>
        <div className="at-views" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "studio"} className={view === "studio" ? "is-on" : ""} onClick={() => setView("studio")}>Colour Studio</button>
          <button type="button" aria-pressed={view === "technical"} className={view === "technical" ? "is-on" : ""} onClick={() => setView("technical")}>Technical Comparison</button>
        </div>
      </header>
      {view === "studio" ? (
        <Atelier key={bag.slug} bag={bag} productionTime={productionTime} mode="admin" />
      ) : (
        <TechnicalComparison key={bag.slug} bag={bag} />
      )}
    </div>
  );
}
