"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import type { NavItem } from "@/lib/dashboard/nav-items";
import { NAV_ICON_BY_LABEL } from "./icons";

/**
 * Static child segments of `/app/{organizationSlug}` that are NOT a
 * workspace slug (Step 5B) — used only to decide whether "Dashboard"
 * should still read as the active nav item while viewing a workspace's
 * own dashboard home (`/app/{org}/{workspaceSlug}`), as opposed to one of
 * these sibling admin pages.
 */
const NON_DASHBOARD_SEGMENTS = [
  "settings", "members", "workspaces", "invitations", "projects", "my-work",
  "workflows", "workflow-executions", "crm", "sales", "marketing", "communications",
  "integrations", "analytics", "founder", "jarvis",
];

export function isItemActive(href: string, pathname: string, dashboardHref: string): boolean {
  if (href !== dashboardHref) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }
  if (pathname === dashboardHref) return true;
  const rest = pathname.startsWith(`${dashboardHref}/`) ? pathname.slice(dashboardHref.length + 1) : null;
  if (!rest) return false;
  return !NON_DASHBOARD_SEGMENTS.includes(rest.split("/")[0]);
}

/**
 * Shared between the desktop sidebar and the mobile drawer (Step 5A) — one
 * definition of the nav's information hierarchy, never duplicated. Touch
 * targets are at least 44px tall (`min-h-11` = 2.75rem = 44px) so the same
 * markup is usable on both desktop and mobile without a separate variant.
 * Derives the active item from the live URL (`usePathname`) rather than a
 * server-passed flag — the parent layout only reliably knows the
 * organization slug, not which of several sibling pages (dashboard home,
 * members, settings) is currently open.
 *
 * `collapsed` renders an icon-only rail (desktop sidebar collapse) — the
 * link's accessible name is preserved via `sr-only` text and a `title`
 * tooltip, never removed, only visually hidden.
 */
export function NavList({ items, dashboardHref, onNavigate, collapsed = false }: { items: NavItem[]; dashboardHref: string; onNavigate?: () => void; collapsed?: boolean }) {
  const pathname = usePathname();
  const groups = items.reduce<Array<{ section: NavItem["section"]; items: NavItem[] }>>((all, item) => {
    const group = all.find((candidate) => candidate.section === item.section);
    if (group) group.items.push(item);
    else all.push({ section: item.section, items: [item] });
    return all;
  }, []);

  return (
    <div className="flex flex-col gap-5">
      {groups.map(({ section, items: sectionItems }) => (
        <section key={section} aria-label={section}>
          {!collapsed ? <p className="mb-2 px-3 text-[0.65rem] font-medium uppercase tracking-[0.18em] text-subtle">{section}</p> : null}
          <ul className="flex flex-col gap-0.5">
      {sectionItems.map((item) => {
        const Icon = NAV_ICON_BY_LABEL[item.label];
        return item.href ? (
          <li key={item.label}>
            <Link
              href={item.href}
              aria-current={isItemActive(item.href, pathname, dashboardHref) ? "page" : undefined}
              onClick={onNavigate}
              title={collapsed ? item.label : undefined}
              className="lynq-transition group relative flex min-h-11 items-center gap-3 rounded-sm px-3 text-sm text-muted hover:bg-white/[0.04] hover:text-foreground aria-[current=page]:bg-glass-strong aria-[current=page]:text-foreground"
            >
              <span aria-hidden="true" className="absolute left-0 h-5 w-[2px] scale-y-0 rounded-full bg-accent transition-transform duration-150 group-aria-[current=page]:scale-y-100" />
              {Icon ? <Icon className="shrink-0 text-current opacity-80 group-aria-[current=page]:opacity-100" /> : null}
              <span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>
            </Link>
          </li>
        ) : (
          <li key={item.label} className="flex min-h-11 items-center justify-between gap-3 px-3 text-sm text-subtle">
            <span className="flex items-center gap-3">
              {Icon ? <Icon className="shrink-0 opacity-50" /> : null}
              <span className={collapsed ? "sr-only" : ""}>{item.label}</span>
            </span>
            {!collapsed ? <span className="rounded-sm border border-border px-1.5 py-0.5 text-[0.6rem] uppercase tracking-[0.1em]">Coming later</span> : null}
          </li>
        );
      })}
          </ul>
        </section>
      ))}
    </div>
  );
}
