import Link from "next/link";
import { Suspense } from "react";
import { InvitationStatusBanner } from "./InvitationStatusBanner";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import type { DashboardSummary } from "@/lib/dashboard/summary";
import type { ProjectStatus } from "@/lib/projects/validation";
import type { WorkflowExecutionStatus } from "@/lib/workflows/validation";

const PROJECT_STATUS_TONE: Record<ProjectStatus, BadgeTone> = {
  proposed: "neutral",
  planning: "info",
  active: "success",
  paused: "warning",
  blocked: "danger",
  completed: "accent",
  cancelled: "neutral",
  archived: "neutral",
};

const EXECUTION_STATUS_TONE: Record<WorkflowExecutionStatus, BadgeTone> = {
  queued: "neutral",
  running: "info",
  waiting: "warning",
  waiting_for_approval: "warning",
  paused: "warning",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
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

/**
 * The real dashboard home (Step 5A, rebuilt in the UI/UX refinement pass
 * with real Projects/Workflows/CRM/pending-work sections). Every number
 * comes from `loadDashboardSummary`'s own real queries — no fabricated
 * metrics anywhere; an organization with no data yet sees an honest
 * empty state per section, never a placeholder number.
 */
export function DashboardHome({
  displayName,
  organizationName,
  workspaceName,
  organizationSlug,
  summary,
}: {
  displayName: string;
  organizationName: string;
  workspaceName: string | null;
  organizationSlug: string;
  summary: DashboardSummary;
}) {
  const base = `/app/${organizationSlug}`;
  const pendingWorkTotal = summary.pendingTaskCount + summary.pendingApprovalCount + summary.pendingFollowUpCount;

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Suspense fallback={null}>
        <InvitationStatusBanner />
      </Suspense>

      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.3em] text-subtle">
          {organizationName}
          {workspaceName ? ` / ${workspaceName}` : ""}
        </p>
        <h1 className="font-serif text-3xl italic font-light text-foreground">Welcome, {displayName}</h1>
        {!workspaceName ? <p className="text-sm text-muted">Select a workspace from the sidebar, or continue here at the organization level.</p> : null}
      </header>

      <section aria-label="Overview" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard href={`${base}/projects`} label="Active projects" value={summary.activeProjectCount} />
        <StatCard href={`${base}/workflow-executions`} label="Running workflows" value={summary.runningExecutionCount} />
        <StatCard
          href={`${base}/crm/opportunities`}
          label="Open opportunities"
          value={summary.openOpportunityCount}
          sublabel={summary.openOpportunityValue > 0 ? `${summary.openOpportunityValue.toLocaleString()} in pipeline` : undefined}
        />
        <StatCard href={`${base}/my-work`} label="Pending work" value={pendingWorkTotal} sublabel={pendingWorkTotal > 0 ? `${summary.pendingTaskCount} tasks · ${summary.pendingApprovalCount} approvals · ${summary.pendingFollowUpCount} follow-ups` : undefined} />
      </section>

      <section aria-label="Active projects" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Active projects</h2>
          <Link href={`${base}/projects`} className="lynq-transition text-xs text-subtle hover:text-foreground">
            View all →
          </Link>
        </div>
        {summary.activeProjects.length === 0 ? (
          <EmptyState title="No active projects yet." description="Projects you own or are a member of will show up here." />
        ) : (
          <ul className="flex flex-col gap-2">
            {summary.activeProjects.map((project) => (
              <li key={project.id}>
                <Card as={Link} href={`${base}/projects/${project.id}`} interactive padding="sm" className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-foreground">{project.name}</span>
                    <span className="text-xs text-subtle">{project.projectKey}</span>
                  </div>
                  <Badge tone={PROJECT_STATUS_TONE[project.status]}>{project.status.replace(/_/g, " ")}</Badge>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Workflow activity" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Workflow activity</h2>
          <Link href={`${base}/workflow-executions`} className="lynq-transition text-xs text-subtle hover:text-foreground">
            View all →
          </Link>
        </div>
        {summary.runningExecutions.length === 0 ? (
          <EmptyState title="No workflows are running right now." description="Start a workflow from its definition page to see progress here." />
        ) : (
          <ul className="flex flex-col gap-2">
            {summary.runningExecutions.map((execution) => (
              <li key={execution.id}>
                <Card as={Link} href={`${base}/workflow-executions/${execution.id}`} interactive padding="sm" className="flex items-center justify-between gap-4">
                  <span className="truncate text-sm text-foreground">Execution {execution.id.slice(0, 8)}</span>
                  <Badge tone={EXECUTION_STATUS_TONE[execution.status]}>{execution.status.replace(/_/g, " ")}</Badge>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="CRM pipeline summary" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Open opportunities</h2>
          <Link href={`${base}/crm/opportunities`} className="lynq-transition text-xs text-subtle hover:text-foreground">
            View all →
          </Link>
        </div>
        {summary.openOpportunities.length === 0 ? (
          <EmptyState title="No open opportunities yet." description="Opportunities created in CRM will show up here." />
        ) : (
          <ul className="flex flex-col gap-2">
            {summary.openOpportunities.map((opportunity) => (
              <li key={opportunity.id}>
                <Card as={Link} href={`${base}/crm/opportunities/${opportunity.id}`} interactive padding="sm" className="flex items-center justify-between gap-4">
                  <span className="truncate text-sm text-foreground">{opportunity.name}</span>
                  <span className="text-sm text-subtle">{opportunity.amount ? `${Number(opportunity.amount).toLocaleString()} ${opportunity.currency ?? ""}` : "—"}</span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
