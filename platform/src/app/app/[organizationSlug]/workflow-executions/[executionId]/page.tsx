import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { getWorkflowExecutionForUser, listWorkflowExecutionTimeline } from "@/lib/workflows/executions";
import { getWorkflowDefinitionForUser } from "@/lib/workflows/definitions";
import { listWorkflowNodes } from "@/lib/workflows/nodes";
import { listNodeExecutionsForExecution } from "@/lib/workflows/node-executions";
import { resolveWorkflowAuthContext, requireWorkflowExecutionManageAuthority } from "@/lib/workflows/authz";
import { InsufficientRoleError, TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { NodeExecutionTimeline } from "@/components/dashboard/workflows/NodeExecutionTimeline";
import { ExecutionControls } from "@/components/dashboard/workflows/ExecutionControls";
import { pauseExecutionAction, resumeExecutionAction, cancelExecutionAction, retryExecutionAction } from "@/lib/dashboard/actions/workflows";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

const EXECUTION_STATUS_TONE: Record<string, BadgeTone> = {
  queued: "neutral",
  running: "info",
  waiting: "warning",
  waiting_for_approval: "warning",
  paused: "warning",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
};

export const dynamic = "force-dynamic";

async function loadExecutionDetailData(db: ReturnType<typeof createDbClient>, organizationSlug: string, executionId: string, actorUserId: string) {
  const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, actorUserId);
  const execution = await getWorkflowExecutionForUser(db, { organizationId: organization.id, executionId, actorUserId });
  const definition = await getWorkflowDefinitionForUser(db, { organizationId: organization.id, definitionId: execution.workflowDefinitionId, actorUserId });
  const [nodes, nodeExecutions, timeline] = await Promise.all([
    listWorkflowNodes(db, { organizationId: organization.id, definitionId: definition.id, versionId: execution.workflowVersionId, actorUserId }),
    listNodeExecutionsForExecution(db, execution.id),
    listWorkflowExecutionTimeline(db, { organizationId: organization.id, executionId, actorUserId }),
  ]);

  const ctx = await resolveWorkflowAuthContext(db, { organizationId: organization.id, workspaceId: definition.workspaceId, actorUserId });
  let canManage = true;
  try {
    await requireWorkflowExecutionManageAuthority(db, ctx, execution.id, { initiatorUserId: execution.initiatorUserId, projectId: execution.projectId });
  } catch (err) {
    if (err instanceof InsufficientRoleError) canManage = false;
    else throw err;
  }

  return { organizationName: organization.name, execution, definition, nodes, nodeExecutions, timeline, canManage };
}

export default async function WorkflowExecutionDetailPage({ params }: { params: Promise<{ organizationSlug: string; executionId: string }> }) {
  const { organizationSlug, executionId } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/workflow-executions/${executionId}`);

  let data: Awaited<ReturnType<typeof loadExecutionDetailData>>;
  try {
    data = await loadExecutionDetailData(db, organizationSlug, executionId, user.userId);
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const { organizationName, execution, definition, nodes, nodeExecutions, timeline, canManage } = data;
  const nodesById = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs
        items={[
          { label: "LYNQ", href: "/app" },
          { label: organizationName, href: `/app/${organizationSlug}` },
          { label: "Workflow executions", href: `/app/${organizationSlug}/workflow-executions` },
          { label: definition.name },
        ]}
      />
      <PageHeader
        title={definition.name}
        actions={
          <>
            <Badge tone={EXECUTION_STATUS_TONE[execution.status] ?? "neutral"}>{execution.status.replace(/_/g, " ")}</Badge>
            <ExecutionControls
              status={execution.status}
              expectedRevision={execution.revision}
              canManage={canManage}
              pauseAction={pauseExecutionAction.bind(null, organizationSlug, executionId)}
              resumeAction={resumeExecutionAction.bind(null, organizationSlug, executionId)}
              cancelAction={cancelExecutionAction.bind(null, organizationSlug, executionId)}
              retryAction={retryExecutionAction.bind(null, organizationSlug, executionId)}
            />
          </>
        }
      />

      {execution.failureClassification ? <p role="alert" className="rounded-sm border border-danger/30 bg-danger-wash px-4 py-3 text-sm text-danger">Failure: {execution.failureClassification}</p> : null}

      <Card padding="sm" variant="flat">
        <dl className="grid gap-4 sm:grid-cols-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-[0.1em] text-subtle">Started</dt>
            <dd className="text-foreground">{execution.startedAt ? execution.startedAt.toLocaleString() : "Not started yet"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.1em] text-subtle">Completed</dt>
            <dd className="text-foreground">{execution.completedAt ? execution.completedAt.toLocaleString() : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.1em] text-subtle">Linked project</dt>
            <dd className="text-foreground">{execution.projectId ? execution.projectId.slice(0, 8) : "None"}</dd>
          </div>
        </dl>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Node activity</h2>
        <NodeExecutionTimeline nodeExecutions={nodeExecutions} nodesById={nodesById} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Activity timeline</h2>
        {timeline.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm text-muted">
            {timeline.map((event) => (
              <li key={event.id}>
                <span className="text-foreground">{event.eventType.replace(/_/g, " ")}</span> — {event.createdAt.toLocaleString()}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No activity recorded yet." />
        )}
      </section>
    </div>
  );
}
