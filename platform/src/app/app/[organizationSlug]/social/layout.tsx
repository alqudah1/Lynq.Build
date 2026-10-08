import { Suspense } from "react";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError, AuthzError } from "@/lib/authz/errors";
import { listPendingApprovals } from "@/lib/social-os/content";
import { SocialSectionNav, type SocialSectionItem } from "@/components/social/SocialSectionNav";
import { SocialMobileTabs, type SocialMobileTab } from "@/components/social/SocialMobileTabs";

export const dynamic = "force-dynamic";

/**
 * Social Command Center section shell (Module 19): one horizontal
 * sub-navigation above every Social page. The pending-approval count is a
 * real query (all brands); a member without marketing access simply sees
 * no count — each page enforces its own authority through the services.
 */
export default async function SocialLayout({ children, params }: { children: React.ReactNode; params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const db = createDbClient(loadEnv());
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/social`);
  let organizationId: string;
  try {
    ({ organization: { id: organizationId } } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId));
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  let pendingCount = 0;
  try {
    pendingCount = (await listPendingApprovals(db, { organizationId, actorUserId: user.userId })).length;
  } catch (err) {
    if (!(err instanceof AuthzError)) throw err;
  }

  const items: SocialSectionItem[] = [
    { label: "Overview", path: "/social" },
    { label: "AI Manager", path: "/social/manager" },
    { label: "Calendar", path: "/social/calendar" },
    { label: "Create", path: "/social/create" },
    { label: "Library", path: "/social/library" },
    { label: "Approvals", path: "/social/approvals", count: pendingCount },
    { label: "Publishing", path: "/social/publishing" },
    { label: "Inbox", path: "/social/inbox" },
    { label: "Analytics", path: "/social/analytics" },
    { label: "Advertising", path: "/social/advertising" },
    { label: "Brands", path: "/social/brands" },
    { label: "Connections", path: "/social/connections" },
    { label: "Automation", path: "/social/automation" },
    { label: "Settings", path: "/social/settings" },
  ];

  const tabs: SocialMobileTab[] = [
    { label: "Home", path: "/social", icon: "home" },
    { label: "Calendar", path: "/social/calendar", icon: "calendar" },
    { label: "Approve", path: "/social/approvals", icon: "check", count: pendingCount },
    { label: "Posts", path: "/social/library", icon: "grid" },
    { label: "Inbox", path: "/social/inbox", icon: "inbox" },
  ];

  return (
    // Bottom padding on phones keeps the last content clear of the floating tab bar.
    <div className="flex flex-1 flex-col pb-24 md:pb-0">
      <Suspense fallback={<div className="min-h-11 border-b border-glass-border" />}>
        <SocialSectionNav organizationSlug={organizationSlug} items={items} />
      </Suspense>
      {children}
      <Suspense fallback={null}>
        <SocialMobileTabs organizationSlug={organizationSlug} tabs={tabs} />
      </Suspense>
    </div>
  );
}
