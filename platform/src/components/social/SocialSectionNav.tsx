"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

export interface SocialSectionItem {
  label: string;
  /** Path under `/app/{organizationSlug}` (e.g. `/social/calendar`). */
  path: string;
  count?: number;
}

/**
 * The Social Command Center's own horizontal sub-navigation. Scrolls
 * horizontally on narrow screens (never wraps into a tall block) and keeps
 * the selected `?brand=` on every link so switching section never loses
 * the brand context. Active state derives from the live URL.
 */
export function SocialSectionNav({ organizationSlug, items }: { organizationSlug: string; items: SocialSectionItem[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const brand = searchParams.get("brand");
  const base = `/app/${organizationSlug}`;
  const listRef = useRef<HTMLUListElement>(null);

  // On a phone only a few tabs fit: keep the active one in view when the page loads or the section changes.
  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    active?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);

  return (
    <nav aria-label="Social Command Center" className="lynq-glass sticky top-0 z-20 border-b border-glass-border">
      {/* `relative` keeps the absolutely-positioned sr-only count labels inside the scroller; otherwise they resolve against the sticky <nav> and widen the whole page on mobile. The mask fades the right edge so it's obvious more tabs are off-screen. */}
      <ul ref={listRef} className="relative flex gap-1 overflow-x-auto px-4 md:px-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] md:[mask-image:none]">
        {items.map((item) => {
          const href = `${base}${item.path}`;
          const active = item.path === "/social" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={item.path} className="shrink-0">
              <Link
                href={brand ? `${href}?brand=${encodeURIComponent(brand)}` : href}
                aria-current={active ? "page" : undefined}
                className={`lynq-transition inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-xs font-medium uppercase tracking-[0.08em] ${active ? "border-accent text-foreground" : "border-transparent text-subtle hover:text-foreground"}`}
              >
                {item.label}
                {item.count ? (
                  <span className="inline-flex min-w-5 items-center justify-center rounded-sm border border-warning/30 bg-warning-wash px-1.5 text-[0.65rem] text-warning">
                    <span className="sr-only">, </span>
                    {item.count}
                    <span className="sr-only"> pending</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
