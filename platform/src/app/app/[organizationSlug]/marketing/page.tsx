import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { getMarketingAnalyticsSummary } from "@/lib/marketing-os/analytics";
import { listPendingMarketingApprovalsForApprover } from "@/lib/marketing-os/approvals";
import { computeNextBestActionsForUser } from "@/lib/marketing-os/next-best-action";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

const NEXT_ACTION_LABEL: Record<string, string> = {
  define_audience: "Define audience",
  create_content: "Finish content",
  review_overdue_content: "Review overdue content",
  resolve_pending_approval: "Resolve approval",
  prepare_upcoming_launch: "Prepare launch",
  review_completed_campaign: "Review campaign",
  configure_utm: "Configure UTM",
  link_workflow: "Link workflow",
  configure_lead_source: "Configure lead source",
  resolve_stalled_project_task: "Resolve stalled task",
  complete_playbook_requirement: "Complete playbook step",
};

function StatCard({ href, label, value, sublabel }: { href: string; label: string; value: number | string; sublabel?: string }) {
  return (
    <Card as={Link} href={href} interactive className="flex flex-col gap-1.5">
      <p className="text-xs uppercase tracking-[0.15em] text-subtle">{label}</p>
      <p className="font-serif text-3xl italic font-light text-foreground">{value}</p>
      {sublabel ? <p className="text-xs text-subtle">{sublabel}</p> : null}
    </Card>
  );
}

function priorityTone(priority: number): BadgeTone {
  if (priority >= 80) return "danger";
  if (priority >= 55) return "warning";
  return "neutral";
}

export default async function MarketingDashboardPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/marketing`);

  let organizationName: string;
  let organizationId: string;
  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationName = organization.name;
    organizationId = organization.id;
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const [analytics, pendingApprovals, nextActions] = await Promise.all([
    getMarketingAnalyticsSummary(db, { organizationId, actorUserId: user.userId }),
    listPendingMarketingApprovalsForApprover(db, { organizationId, actorUserId: user.userId }),
    computeNextBestActionsForUser(db, { organizationId, forUserId: user.userId, actorUserId: user.userId }),
  ]);

  const activeCampaignCount = (analytics.campaignsByStatus.active ?? 0) + (analytics.campaignsByStatus.ready ?? 0);

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Marketing" }]} />
      <PageHeader title="Marketing" description="The operational layer for planning, executing, and measuring campaigns — built on CRM Core, Sales OS, and the Workflow Engine." />

      <section aria-label="Overview" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard href={`/app/${organizationSlug}/marketing/campaigns?status=active`} label="Active campaigns" value={activeCampaignCount} sublabel={`${analytics.campaignsStartingSoon} starting soon`} />
        <StatCard href={`/app/${organizationSlug}/marketing/content?status=draft`} label="Overdue content" value={analytics.overdueContentCount} />
        <StatCard href={`/app/${organizationSlug}/marketing/my-work`} label="Pending approvals" value={pendingApprovals.length} />
        <StatCard href={`/app/${organizationSlug}/marketing/budget`} label="Planned budget" value={analytics.budgetPlannedTotal.toLocaleString()} sublabel={`${analytics.budgetRecordedSpendTotal.toLocaleString()} recorded spend`} />
      </section>

      <section aria-label="CRM outcomes" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card padding="sm" className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-[0.15em] text-subtle">Campaign-sourced leads</p>
          <p className="font-serif text-2xl italic font-light text-foreground">{analytics.campaignSourcedLeadCount}</p>
        </Card>
        <Card padding="sm" className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-[0.15em] text-subtle">Campaigns by status</p>
          <p className="text-xs text-subtle">{Object.entries(analytics.campaignsByStatus).map(([status, count]) => `${status}: ${count}`).join(" · ") || "No campaigns yet"}</p>
        </Card>
        <Card padding="sm" className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-[0.15em] text-subtle">Content by status</p>
          <p className="text-xs text-subtle">{Object.entries(analytics.contentByStatus).map(([status, count]) => `${status}: ${count}`).join(" · ") || "No content yet"}</p>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Your next-best-actions</h2>
          <Link href={`/app/${organizationSlug}/marketing/my-work`} className="lynq-transition text-xs text-subtle hover:text-foreground">
            View all →
          </Link>
        </div>
        {nextActions.length === 0 ? (
          <EmptyState title="No recommended actions right now." description="You're caught up." />
        ) : (
          <ul className="flex flex-col gap-2">
            {nextActions.slice(0, 5).map((action, i) => (
              <li key={`${action.recordType}-${action.recordId}-${i}`}>
                <Card padding="sm" className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-foreground">{NEXT_ACTION_LABEL[action.actionType] ?? action.actionType}</span>
                    <span className="text-xs text-subtle">{action.explanation}</span>
                  </div>
                  <Badge tone={priorityTone(action.priority)}>{action.reasonCode.replace(/_/g, " ")}</Badge>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
