import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { projectExecutionLinks, projectTasks, projects } from "@/db/schema";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { getExecutionForUser, type AgentExecutionStatus } from "@/lib/agent-runtime/executions";
import { listArtifactsForExecution } from "@/lib/agent-runtime/artifacts";
import { getExecutionTimeline } from "@/lib/agent-runtime/events";
import { getLatestPlan, getPlanSteps } from "@/lib/agent-runtime/plans";
import { resolveAgentById } from "@/lib/agents/agents";
import { getAgentOfficeIdentity } from "@/lib/office/view";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<AgentExecutionStatus, BadgeTone> = {
  queued: "neutral",
  assigned: "neutral",
  gathering_context: "info",
  planning: "info",
  reasoning: "info",
  waiting: "warning",
  executing: "info",
  delegating: "info",
  human_approval: "warning",
  verifying: "info",
  paused: "warning",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
  archived: "neutral",
};

const STEP_TONE: Record<string, BadgeTone> = {
  pending: "neutral",
  completed: "success",
  failed: "danger",
  skipped: "warning",
};

function readable(value: string) {
  return value.replaceAll("_", " ");
}

function externalHttpUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export default async function AgentExecutionDetailPage({ params }: { params: Promise<{ organizationSlug: string; executionId: string }> }) {
  const { organizationSlug, executionId } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/agent-executions/${executionId}`);

  let organization: Awaited<ReturnType<typeof getOrganizationBySlugForUser>>["organization"];
  let execution: Awaited<ReturnType<typeof getExecutionForUser>>;
  try {
    ({ organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId));
    execution = await getExecutionForUser(db, { organizationId: organization.id, executionId, actorUserId: user.userId });
  } catch (error) {
    if (error instanceof TenantResourceNotFoundError) notFound();
    throw error;
  }

  const [artifacts, timeline, plan, agent, linkedRows] = await Promise.all([
      listArtifactsForExecution(db, organization.id, execution.id),
      getExecutionTimeline(db, { organizationId: organization.id, executionId: execution.id, limit: 100 }),
      getLatestPlan(db, execution.id),
      execution.assignedAgentId ? resolveAgentById(db, execution.assignedAgentId) : null,
      db
        .select({ projectId: projects.id, projectName: projects.name, taskTitle: projectTasks.title })
        .from(projectExecutionLinks)
        .innerJoin(projects, and(eq(projects.id, projectExecutionLinks.projectId), eq(projects.organizationId, projectExecutionLinks.organizationId)))
        .innerJoin(projectTasks, and(eq(projectTasks.id, projectExecutionLinks.taskId), eq(projectTasks.organizationId, projectExecutionLinks.organizationId)))
        .where(and(eq(projectExecutionLinks.organizationId, organization.id), eq(projectExecutionLinks.executionId, execution.id)))
        .limit(1),
  ]);
  const steps = plan ? await getPlanSteps(db, plan.id) : [];
  const linked = linkedRows[0] ?? null;
  const employee = agent ? getAgentOfficeIdentity(agent) : null;
  const hasExternalEvidence = artifacts.some((artifact) => Boolean(externalHttpUrl(artifact.externalRef)) || /https?:\/\//i.test(artifact.content ?? ""));

  return (
      <div className="flex flex-col gap-8 px-5 py-7 md:px-8 lg:px-10 lg:py-9">
        <nav aria-label="Back navigation" className="flex flex-wrap gap-4 text-xs text-subtle">
          {linked ? <Link href={`/app/${organizationSlug}/jarvis/${linked.projectId}`} className="hover:text-foreground">← Back to Jarvis directive</Link> : null}
          <Link href={`/app/${organizationSlug}/jarvis`} className="hover:text-foreground">Jarvis Command Center</Link>
          {linked ? <Link href={`/app/${organizationSlug}/projects/${linked.projectId}`} className="hover:text-foreground">Full project</Link> : null}
        </nav>

        <PageHeader
          eyebrow={employee?.title ?? "Jarvis employee execution"}
          title={linked?.taskTitle ?? "Execution evidence"}
          description={execution.goal}
          actions={<Badge tone={STATUS_TONE[execution.status]} dot>{readable(execution.status)}</Badge>}
        />

        <Card variant="surface" className="border-l-4 border-l-accent">
          <p className="text-xs uppercase tracking-[0.18em] text-accent-foreground">What this status proves</p>
          <p className="mt-2 text-sm leading-6 text-foreground">
            {execution.status === "completed"
              ? `This employee finished the internal plan and produced ${artifacts.length} saved deliverable${artifacts.length === 1 ? "" : "s"}.`
              : "This employee is still working. A completed internal plan has not been recorded yet."}
          </p>
          <p className="mt-2 text-sm leading-6 text-muted">
            {hasExternalEvidence
              ? "At least one deliverable contains an external link or reference. Open it below and verify the source before treating the real-world action as complete."
              : "No external link or file is attached. This proves internal analysis only—not that web research, outreach, booking, publishing, or another real-world action happened."}
          </p>
        </Card>

        {execution.waitReason ? (
          <Card variant="flat" className="border-warning/40 bg-warning-wash">
            <p className="text-xs uppercase tracking-[0.16em] text-warning">Waiting reason</p>
            <p className="mt-2 text-sm text-foreground">{execution.waitReason}</p>
          </Card>
        ) : null}

        <section aria-labelledby="execution-plan-heading" className="space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-subtle">Internal process</p>
            <h2 id="execution-plan-heading" className="mt-1 font-serif text-3xl font-light text-foreground">Plan and checkpoints</h2>
          </div>
          {steps.length > 0 ? (
            <ol className="grid gap-3 md:grid-cols-2">
              {steps.map((step) => (
                <Card as="li" key={step.id} variant="flat" padding="sm" className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs text-subtle">Step {step.stepNumber}</p>
                    <p className="mt-1 text-sm leading-6 text-foreground">{step.description}</p>
                  </div>
                  <Badge tone={STEP_TONE[step.status] ?? "neutral"}>{step.status}</Badge>
                </Card>
              ))}
            </ol>
          ) : <p className="text-sm text-muted">No durable plan has been recorded.</p>}
        </section>

        <section id="deliverables" aria-labelledby="execution-deliverables-heading" className="scroll-mt-24 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-subtle">Saved evidence</p>
            <h2 id="execution-deliverables-heading" className="mt-1 font-serif text-3xl font-light text-foreground">Deliverables</h2>
          </div>
          {artifacts.length > 0 ? artifacts.map((artifact) => {
            const externalUrl = externalHttpUrl(artifact.externalRef);
            return (
            <Card as="article" key={artifact.id} variant="surface" className="overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
                <div>
                  <h3 className="text-lg font-medium text-foreground">{artifact.title}</h3>
                  <p className="mt-1 text-xs text-subtle">Created {artifact.createdAt.toLocaleString()} · {readable(artifact.artifactType)}</p>
                </div>
                <Badge tone={artifact.status === "approved" || artifact.status === "published" ? "success" : "neutral"}>{artifact.status}</Badge>
              </div>
              {artifact.content ? <pre className="mt-5 whitespace-pre-wrap break-words font-sans text-sm leading-7 text-muted">{artifact.content}</pre> : null}
              {externalUrl ? <a href={externalUrl} target="_blank" rel="noreferrer" className="mt-5 inline-flex text-sm text-accent-foreground hover:text-foreground">Open external evidence ↗</a> : null}
            </Card>
            );
          }) : <p className="text-sm text-muted">No deliverable has been saved yet.</p>}
        </section>

        <section aria-labelledby="execution-timeline-heading" className="space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-subtle">Audit trail</p>
            <h2 id="execution-timeline-heading" className="mt-1 font-serif text-3xl font-light text-foreground">Activity timeline</h2>
          </div>
          <Card variant="flat" padding="sm">
            {timeline.events.length > 0 ? (
              <ol className="divide-y divide-border">
                {timeline.events.map((event) => (
                  <li key={event.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                    <span className="text-foreground">{readable(event.eventType)}</span>
                    <time className="text-xs text-subtle">{event.createdAt.toLocaleString()}</time>
                  </li>
                ))}
              </ol>
            ) : <p className="text-sm text-muted">No activity has been recorded.</p>}
          </Card>
        </section>
      </div>
  );
}
