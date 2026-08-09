/**
 * Pure structural wrapper for every `/app/*` route (Step 5A) — deliberately
 * does NOT run its own session gate. Every actual leaf under this tree
 * already calls `requireDashboardUser` independently and unconditionally
 * (`/app/page.tsx`, and `/app/[organizationSlug]/layout.tsx` for
 * everything beneath it) — per "every route must resolve authenticated
 * user," not "every layout." Adding a redundant check here would only
 * ever fire BEFORE the more specific nested checks get a chance to, which
 * would make every unauthenticated redirect fall back to the generic
 * `/app` return path instead of the actual, more specific path the user
 * was trying to reach (confirmed by direct testing against a real
 * session during this step) — worse UX for zero additional security,
 * since nothing renders without passing through a nested gate regardless.
 *
 * No application-wide middleware is introduced here or anywhere else —
 * every check is explicit, route/layout-level, and independently
 * testable, per Step 5A's instruction not to add global middleware yet.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-full flex-1 flex-col">{children}</div>;
}
