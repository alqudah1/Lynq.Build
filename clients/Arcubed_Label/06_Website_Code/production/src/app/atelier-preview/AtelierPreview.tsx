"use client";

import { useState } from "react";
import type { Bag } from "@/lib/types";
import Atelier from "@/components/atelier/Atelier";

export default function AtelierPreview({ bags, productionTime }: { bags: Bag[]; productionTime: string | null }) {
  const [bagIdx, setBagIdx] = useState(0);
  const bag = bags[bagIdx];
  return (
    <div className="cl ap">
      <header className="ap-intro">
        <div>
          <p className="ap-kicker">Arcubed Atelier</p>
          <h1 className="ap-title">Explore your bag in different colours.</h1>
        </div>
        <nav className="at-bags ap-bags" aria-label="Choose a bag">
          {bags.map((b, i) => (
            <button key={b.slug} type="button" aria-pressed={i === bagIdx} className={i === bagIdx ? "is-on" : ""} onClick={() => setBagIdx(i)}>
              {b.name}
            </button>
          ))}
        </nav>
      </header>
      <Atelier key={bag.slug} bag={bag} productionTime={productionTime} mode="client" />
    </div>
  );
}
