import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { getWorkflowDefinitionForUser, getLegalWorkflowDefinitionTransitions } from "@/lib/workflows/definitions";
import { listWorkflowVersions } from "@/lib/workflows/versions";
import { listWorkflowExecutionsForUser } from "@/lib/workflows/executions";
import { listProjectsForUser } from "@/lib/projects/projects";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { WorkflowStatusControl } from "@/components/dashboard/workflows/WorkflowStatusControl";
import { VersionRow } from "@/components/dashboard/workflows/VersionRow";
import { StartExecutionForm } from "@/components/dashboard/workflows/StartExecutionForm";
import { ExecutionRow } from "@/components/dashboard/workflows/ExecutionRow";
import { transitionWorkflowAction, startExecutionAction } from "@/lib/dashboard/actions/workflows";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, THead, TBody, Tr, Th } from "@/components/ui/Table";

export const dynamic = "force-dynamic";

async function loadWorkflowDetailData(db: ReturnType<typeof createDbClient>, organizationSlug: string, definitionId: string, actorUserId: string) {
  const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, actorUserId);
  const definition = await getWorkflowDefinitionForUser(db, { organizationId: organization.id, definitionId, actorUserId });
  const [versions, executions, projects] = await Promise.all([
    listWorkflowVersions(db, { organizationId: organization.id, definitionId, actorUserId }),
    listWorkflowExecutionsForUser(db, { organizationId: organization.id, actorUserId, workflowDefinitionId: definitionId }),
    listProjectsForUser(db, { organizationId: organization.id, actorUserId }),
  ]);
  const legalTargets = getLegalWorkflowDefinitionTransitions(definition.status);
  return { organizationName: organization.name, definition, versions, executions, projects, legalTargets };
}

export default async function WorkflowDetailPage({ params }: { params: Promise<{ organizationSlug: string; workflowId: string }> }) {
  const { organizationSlug, workflowId } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/workflows/${workflowId}`);

  let data: Awaited<ReturnType<typeof loadWorkflowDetailData>>;
  try {
    data = await loadWorkflowDetailData(db, organizationSlug, workflowId, user.userId);
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const { organizationName, definition, versions, executions, projects, legalTargets } = data;

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs
        items={[
          { label: "LYNQ", href: "/app" },
          { label: organizationName, href: `/app/${organizationSlug}` },
          { label: "Workflows", href: `/app/${organizationSlug}/workflows` },
          { label: definition.name },
        ]}
      />
      <PageHeader
        eyebrow={definition.workflowKey}
        title={definition.name}
        description={definition.description ?? undefined}
        actions={
          <Link
            href={`/app/${organizationSlug}/workflows/${workflowId}/builder`}
            className="lynq-transition flex min-h-11 items-center rounded-sm border border-border px-5 text-xs font-medium uppercase tracking-[0.08em] text-foreground hover:border-border-strong hover:bg-white/[0.03]"
          >
            Open builder
          </Link>
        }
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Status</h2>
        <WorkflowStatusControl currentStatus={definition.status} legalTargets={legalTargets} expectedRevision={definition.revision} action={transitionWorkflowAction.bind(null, organizationSlug, workflowId)} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Versions</h2>
        {versions.length > 0 ? (
          <ul className="flex flex-col">
            {versions.map((version) => (
              <VersionRow key={version.id} organizationSlug={organizationSlug} definitionId={workflowId} version={version} isCurrent={version.id === definition.currentPublishedVersionId} />
            ))}
          </ul>
        ) : (
          <EmptyState title="No versions yet." description="Open the builder to create the first draft." />
        )}
      </section>

      {definition.status === "published" ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Start a new execution</h2>
          <StartExecutionForm projects={projects.map((p) => ({ id: p.id, name: p.name }))} action={startExecutionAction.bind(null, organizationSlug, workflowId)} />
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Recent executions</h2>
        {executions.length > 0 ? (
          <Table>
            <THead>
              <Tr>
                <Th>Workflow</Th>
                <Th>Status</Th>
                <Th className="hidden sm:table-cell">Started</Th>
                <Th className="hidden md:table-cell">Completed</Th>
              </Tr>
            </THead>
            <TBody>
              {executions.map((execution) => (
                <ExecutionRow key={execution.id} organizationSlug={organizationSlug} execution={execution} workflowName={definition.name} />
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState title="No executions yet." />
        )}
      </section>
    </div>
  );
}
