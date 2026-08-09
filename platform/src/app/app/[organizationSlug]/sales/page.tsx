import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { countLeadsPerQueue } from "@/lib/sales-os/lead-queues";
import { computeSalesAnalytics } from "@/lib/sales-os/analytics";
import { resolveEffectiveSalesConfiguration } from "@/lib/sales-os/configuration";
import { listPendingSalesApprovalsForApprover } from "@/lib/sales-os/approvals";
import { computeNextBestActionsForUser } from "@/lib/sales-os/next-best-action";
import { listSalesTargets, computeTargetProgress } from "@/lib/sales-os/targets";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProgressBar } from "@/components/ui/ProgressBar";

export const dynamic = "force-dynamic";

const NEXT_ACTION_LABEL: Record<string, string> = {
  contact_lead: "Contact lead",
  complete_qualification_field: "Complete qualification",
  schedule_follow_up: "Follow up",
  review_proposal: "Review proposal",
  move_opportunity: "Review stage move",
  resolve_pending_approval: "Resolve approval",
  review_stale_opportunity: "Review stale record",
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

export default async function SalesDashboardPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/sales`);

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

  const config = await resolveEffectiveSalesConfiguration(db, organizationId, null);
  const [queueCounts, analytics, pendingApprovals, nextActions, myTargets] = await Promise.all([
    countLeadsPerQueue(db, { organizationId, actorUserId: user.userId }),
    computeSalesAnalytics(db, { organizationId, staleOpportunityThresholdDays: config.staleOpportunityThresholdDays, actorUserId: user.userId }),
    listPendingSalesApprovalsForApprover(db, { organizationId, actorUserId: user.userId }),
    computeNextBestActionsForUser(db, { organizationId, forUserId: user.userId, actorUserId: user.userId }),
    listSalesTargets(db, { organizationId, scopeType: "individual", userId: user.userId, actorUserId: user.userId }),
  ]);

  const primaryTarget = myTargets[0] ?? null;
  const targetProgress = primaryTarget ? await computeTargetProgress(db, { organizationId, targetId: primaryTarget.id, actorUserId: user.userId }) : null;

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Sales" }]} />
      <PageHeader title="Sales" description="The operational layer over CRM — assignment, qualification, playbooks, and forecasting." />

      <section aria-label="Overview" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard href={`/app/${organizationSlug}/sales/leads?queue=unassigned`} label="Unassigned leads" value={queueCounts.unassigned} />
        <StatCard href={`/app/${organizationSlug}/sales/opportunities`} label="Open opportunities" value={analytics.opportunitiesByStage.reduce((sum, s) => sum + s.count, 0)} sublabel={`${analytics.openPipelineValue.toLocaleString()} in pipeline`} />
        <StatCard href={`/app/${organizationSlug}/sales/opportunities?filter=stale`} label="Stale opportunities" value={analytics.staleOpportunityCount} />
        <StatCard href={`/app/${organizationSlug}/sales/my-work`} label="Pending approvals" value={pendingApprovals.length} />
      </section>

      {targetProgress ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Your target progress</h2>
          <Card padding="sm" className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm text-foreground">
                {targetProgress.target.metricType.replace(/_/g, " ")} — {targetProgress.target.periodStart.toLocaleDateString()} to {targetProgress.target.periodEnd.toLocaleDateString()}
              </p>
              <p className="text-xs text-subtle">
                {targetProgress.actualValue.toLocaleString()} of {Number(targetProgress.target.targetValue).toLocaleString()}
              </p>
            </div>
            <ProgressBar percentage={Math.round(Math.min(1, targetProgress.progressRatio) * 100)} />
          </Card>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Your next-best-actions</h2>
          <Link href={`/app/${organizationSlug}/sales/my-work`} className="lynq-transition text-xs text-subtle hover:text-foreground">
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

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Pipeline by stage</h2>
        {analytics.opportunitiesByStage.length === 0 ? (
          <EmptyState title="No open opportunities yet." />
        ) : (
          <ul className="flex flex-col gap-2">
            {analytics.opportunitiesByStage.map((stage) => (
              <Card as="li" key={stage.stageId} padding="sm" className="flex items-center justify-between gap-4">
                <span className="text-sm text-foreground">{stage.stageName}</span>
                <span className="text-sm text-subtle">
                  {stage.count} opportunit{stage.count === 1 ? "y" : "ies"} · {stage.value.toLocaleString()}
                </span>
              </Card>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function priorityTone(priority: number): BadgeTone {
  if (priority >= 80) return "danger";
  if (priority >= 55) return "warning";
  return "neutral";
}
