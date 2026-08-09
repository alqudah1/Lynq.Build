import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { getSalesWorkQueueForUser } from "@/lib/sales-os/work-queue";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

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

export default async function SalesMyWorkPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/sales/my-work`);

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

  const queue = await getSalesWorkQueueForUser(db, { organizationId, forUserId: user.userId, actorUserId: user.userId });

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Sales", href: `/app/${organizationSlug}/sales` }, { label: "My work" }]} />
      <PageHeader title="My Sales work" description="A unified, prioritized view over your assigned leads, follow-ups, playbook actions, approvals, and workflow tasks — nothing here is a duplicate record." />

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Next-best-actions</h2>
        {queue.nextBestActions.length === 0 ? (
          <EmptyState title="No recommended actions right now." />
        ) : (
          <ul className="flex flex-col gap-2">
            {queue.nextBestActions.map((action, i) => (
              <li key={`${action.recordType}-${action.recordId}-${i}`}>
                <Card
                  as={Link}
                  href={action.recordType === "crm_lead" ? `/app/${organizationSlug}/sales/leads/${action.recordId}` : `/app/${organizationSlug}/sales/opportunities/${action.recordId}`}
                  interactive
                  padding="sm"
                  className="flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-foreground">{NEXT_ACTION_LABEL[action.actionType] ?? action.actionType}</span>
                    <span className="text-xs text-subtle">{action.explanation}</span>
                  </div>
                  <Badge tone={action.priority >= 80 ? "danger" : action.priority >= 55 ? "warning" : "neutral"}>{action.reasonCode.replace(/_/g, " ")}</Badge>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Assigned leads</h2>
        {queue.assignedLeads.length === 0 ? (
          <EmptyState title="No leads assigned to you." />
        ) : (
          <ul className="flex flex-col gap-2">
            {queue.assignedLeads.map((lead) => (
              <li key={lead.id}>
                <Card as={Link} href={`/app/${organizationSlug}/sales/leads/${lead.id}`} interactive padding="sm" className="flex items-center justify-between gap-3">
                  <span className="text-sm text-foreground">Lead {lead.id.slice(0, 8)}</span>
                  <Badge tone="neutral">{lead.status}</Badge>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Open follow-ups</h2>
        {queue.openFollowUps.length === 0 ? (
          <EmptyState title="No open follow-ups." />
        ) : (
          <ul className="flex flex-col gap-2">
            {queue.openFollowUps.map((f) => (
              <Card as="li" key={f.id} padding="sm" className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">{f.title}</span>
                <span className="text-xs text-subtle">{f.dueAt ? f.dueAt.toLocaleDateString() : "No due date"}</span>
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Active qualification sessions</h2>
        {queue.activeQualificationSessions.length === 0 ? (
          <EmptyState title="No active qualification sessions." />
        ) : (
          <ul className="flex flex-col gap-2">
            {queue.activeQualificationSessions.map((run) => (
              <Card as={Link} href={`/app/${organizationSlug}/sales/leads/${run.leadId}`} key={run.id} interactive padding="sm" className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">Lead {run.leadId.slice(0, 8)}</span>
                <Badge tone="info">{run.status.replace(/_/g, " ")}</Badge>
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Active opportunity playbooks</h2>
        {queue.activeOpportunityPlaybookRuns.length === 0 ? (
          <EmptyState title="No active opportunity playbook runs." />
        ) : (
          <ul className="flex flex-col gap-2">
            {queue.activeOpportunityPlaybookRuns.map((run) => (
              <Card as={Link} href={`/app/${organizationSlug}/sales/opportunities/${run.opportunityId}`} key={run.id} interactive padding="sm" className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">Opportunity {run.opportunityId.slice(0, 8)}</span>
                <Badge tone="info">{run.status}</Badge>
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Pending approvals</h2>
        {queue.pendingSalesApprovals.length === 0 ? (
          <EmptyState title="No pending approvals." />
        ) : (
          <ul className="flex flex-col gap-2">
            {queue.pendingSalesApprovals.map((approval) => (
              <Card as="li" key={approval.id} padding="sm" className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">{approval.requestedAction}</span>
                <Badge tone="warning">{approval.riskLevel}</Badge>
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Sales workflow tasks</h2>
        {queue.salesWorkflowHumanTasks.length === 0 ? (
          <EmptyState title="No sales workflow tasks." />
        ) : (
          <ul className="flex flex-col gap-2">
            {queue.salesWorkflowHumanTasks.map((task) => (
              <Card as="li" key={task.id} padding="sm" className="text-sm text-foreground">
                {task.title}
              </Card>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
