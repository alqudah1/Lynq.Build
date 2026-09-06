"use client";

// Scroll-linked drift for the hero composition.
//
// Sets one CSS custom property (--p, 0..1) on the hero element from scroll
// position; every object's movement is expressed in CSS from that single
// value. One rAF-throttled listener, one style write per frame — no
// per-element JS animation, no animation library.
//
// Deliberately restrained: objects drift a few percent at different rates to
// give depth. No bobbing, no springs, no infinite loops.

import { useEffect, useRef, type ReactNode } from "react";

export default function HeroCollage({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      // 0 when the hero's top is at the viewport top, 1 when scrolled past.
      const p = Math.min(1, Math.max(0, -rect.top / Math.max(rect.height, 1)));
      el.style.setProperty("--p", p.toFixed(4));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="hero-collage" ref={ref}>
      {children}
    </div>
  );
}
