"use client";

// Mask reveal: lines wipe up from behind their own edge rather than fading in.
//
// Implemented directly (clip-path + IntersectionObserver) rather than pulled
// from a component registry — the mechanic is a few lines of CSS, and adding an
// animation dependency for decorative motion costs more than it returns.
//
// Content is visible by default and the mask applies only under `.js` (set
// inline in layout.tsx before paint), so a JS failure never leaves a blank page.

import { useEffect, useRef, type ReactNode } from "react";

export default function MaskReveal({
  children,
  as: Tag = "div",
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  as?: "div" | "span" | "p" | "h1" | "h2";
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

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
      { rootMargin: "0px 0px -8% 0px", threshold: 0.02 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const T = Tag as "div";
  return (
    <T
      ref={ref}
      className={`mr${className ? ` ${className}` : ""}`}
      style={delay ? ({ "--mr-delay": `${delay}ms` } as React.CSSProperties) : undefined}
    >
      <span className="mr-inner">{children}</span>
    </T>
  );
}
