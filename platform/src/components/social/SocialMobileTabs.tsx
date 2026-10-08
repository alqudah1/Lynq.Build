"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

type Icon = "home" | "calendar" | "check" | "grid" | "inbox";

export interface SocialMobileTab {
  label: string;
  /** Path under `/app/{organizationSlug}` (e.g. `/social/calendar`). */
  path: string;
  icon: Icon;
  count?: number;
}

const ICONS: Record<Icon, React.ReactNode> = {
  home: <path d="M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10" />,
  calendar: <path d="M4 6.5h16v13H4zM4 10.5h16M8 4v4M16 4v4" />,
  check: <path d="M4.5 12.5 9.5 17.5 19.5 7.5" />,
  grid: <path d="M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z" />,
  inbox: <path d="M4 5.5h16v13H4zM4 13h5l1.5 2.5h3L15 13h5" />,
};

/**
 * Phone-only bottom tab bar for the Social section — the five places the
 * owner actually goes from a phone (overview, calendar, approvals, library,
 * inbox), in the style of a native app: icons always, the label under the
 * active one, a pill that sits above the home indicator (safe-area aware).
 * The full section list stays in the horizontal tabs at the top.
 */
export function SocialMobileTabs({ organizationSlug, tabs }: { organizationSlug: string; tabs: SocialMobileTab[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const brand = searchParams.get("brand");
  const base = `/app/${organizationSlug}`;

  return (
    <nav aria-label="Social quick navigation" className="fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
      <ul className="lynq-glass mx-auto flex max-w-md items-stretch justify-between rounded-full border border-glass-border bg-[#0b0b0c]/85 px-2 py-1.5 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.8)]">
        {tabs.map((tab) => {
          const href = `${base}${tab.path}`;
          const active = tab.path === "/social" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={tab.path} className="flex flex-1">
              <Link
                href={brand ? `${href}?brand=${encodeURIComponent(brand)}` : href}
                aria-current={active ? "page" : undefined}
                aria-label={tab.count ? `${tab.label}, ${tab.count} pending` : tab.label}
                className={`lynq-transition relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-full px-1 ${active ? "bg-white/[0.08] text-foreground" : "text-subtle active:bg-white/[0.06]"}`}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-5 w-5 ${active ? "stroke-accent" : "stroke-current"}`} fill="none" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  {ICONS[tab.icon]}
                </svg>
                <span className={`text-[0.6rem] font-medium uppercase tracking-[0.08em] ${active ? "" : "sr-only"}`}>{tab.label}</span>
                {tab.count ? (
                  <span aria-hidden="true" className="absolute right-2 top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[0.6rem] font-semibold leading-4 text-background">
                    {tab.count > 9 ? "9+" : tab.count}
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
