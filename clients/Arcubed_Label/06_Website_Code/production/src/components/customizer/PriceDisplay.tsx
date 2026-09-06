"use client";

import { useEffect, useRef, useState } from "react";
import { money } from "@/lib/pricing";

export default function PriceDisplay({ price, className }: { price: number; className: string }) {
  const [pulse, setPulse] = useState(false);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setPulse(false);
    const id = requestAnimationFrame(() => setPulse(true));
    return () => cancelAnimationFrame(id);
  }, [price]);

  return <span className={`${className}${pulse ? " pulse" : ""}`}>{money(price)}</span>;
}
