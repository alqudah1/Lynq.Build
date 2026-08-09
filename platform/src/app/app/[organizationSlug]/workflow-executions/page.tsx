import { notFound } from "next/navigation";
import { inArray } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { workflowDefinitions } from "@/db/schema";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listWorkflowExecutionsForUser } from "@/lib/workflows/executions";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { ExecutionRow } from "@/components/dashboard/workflows/ExecutionRow";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, THead, TBody, Tr, Th } from "@/components/ui/Table";

export const dynamic = "force-dynamic";

export default async function WorkflowExecutionsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/workflow-executions`);

  let organizationName: string;
  let executions: Awaited<ReturnType<typeof listWorkflowExecutionsForUser>>;
  let definitionNameById: Map<string, string>;
  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationName = organization.name;
    executions = await listWorkflowExecutionsForUser(db, { organizationId: organization.id, actorUserId: user.userId });
    const definitionIds = [...new Set(executions.map((e) => e.workflowDefinitionId))];
    const definitions = definitionIds.length > 0 ? await db.select({ id: workflowDefinitions.id, name: workflowDefinitions.name }).from(workflowDefinitions).where(inArray(workflowDefinitions.id, definitionIds)) : [];
    definitionNameById = new Map(definitions.map((d) => [d.id, d.name]));
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Workflow executions" }]} />
      <PageHeader title="Workflow executions" />

      {executions.length === 0 ? (
        <EmptyState title="No workflow executions yet." />
      ) : (
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
              <ExecutionRow key={execution.id} organizationSlug={organizationSlug} execution={execution} workflowName={definitionNameById.get(execution.workflowDefinitionId) ?? "Unknown workflow"} />
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
