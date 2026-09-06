"use client";

// One IntersectionObserver-driven reveal primitive for the editorial sections.
//
// Deliberately NOT a fade-up on every element — that is the generic look the
// art direction rules out. It adds a single `is-in` class and CSS decides what
// that means per section (masked wipe, stagger, drift). Elements start visible
// to crawlers and to anyone with JS off; the observer only *adds* motion.
//
// prefers-reduced-motion is honoured in CSS (see globals.css), so reduced-
// motion users get the finished state with no transition rather than a
// half-animated one.

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

/** The tags this wrapper is actually used with. Kept narrow on purpose: a bare
 *  ElementType collapses the intrinsic prop union to `never`, which then
 *  rejects ref/className/style. */
type RevealTag = "div" | "section" | "article" | "header" | "figure" | "ul" | "li" | "p" | "h2";

export default function Reveal({
  children,
  as = "div",
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  as?: RevealTag;
  className?: string;
  /** Stagger index, in ms. Applied as a CSS custom property, not a timer. */
  delay?: number;
}) {
  // Rendered through one concrete intrinsic signature; `as` still controls the
  // emitted tag at runtime.
  const Tag = as as "div";
  const ref = useRef<HTMLDivElement | null>(null);

  // Toggles a class directly rather than setting state: revealing is a purely
  // visual, one-way transition, so a re-render buys nothing and this keeps the
  // work off the React tree entirely (also why there is no setState-in-effect).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("is-in");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.classList.add("is-in");
            io.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`reveal${className ? ` ${className}` : ""}`}
      style={delay ? ({ "--reveal-delay": `${delay}ms` } as CSSProperties) : undefined}
    >
      {children}
    </Tag>
  );
}
