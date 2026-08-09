import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listWorkspacesForUser } from "@/lib/workspaces/workspaces";
import { listWorkflowDefinitionsForUser } from "@/lib/workflows/definitions";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { WorkflowRow } from "@/components/dashboard/workflows/WorkflowRow";
import { SeedTemplatesForm } from "@/components/dashboard/workflows/SeedTemplatesForm";
import { seedTemplatesAction } from "@/lib/dashboard/actions/workflows";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, THead, TBody, Tr, Th } from "@/components/ui/Table";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/workflows`);

  let organizationName: string;
  let workflows: Awaited<ReturnType<typeof listWorkflowDefinitionsForUser>>;
  let workspaceNameById: Map<string, string>;
  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationName = organization.name;
    workflows = await listWorkflowDefinitionsForUser(db, { organizationId: organization.id, actorUserId: user.userId });
    const workspaces = await listWorkspacesForUser(db, user.userId);
    workspaceNameById = new Map(workspaces.filter((w) => w.organizationId === organization.id).map((w) => [w.id, w.name]));
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Workflows" }]} />
      <PageHeader
        title="Workflows"
        description="Structured, repeatable business processes."
        actions={
          <>
            <SeedTemplatesForm action={seedTemplatesAction.bind(null, organizationSlug)} />
            <Link href={`/app/${organizationSlug}/workflows/new`} className="lynq-transition flex min-h-11 items-center rounded-sm bg-foreground px-5 text-xs font-medium uppercase tracking-[0.08em] text-background hover:opacity-90">
              New workflow
            </Link>
          </>
        }
      />

      {workflows.length === 0 ? (
        <EmptyState title="No workflows yet." description="Create the first one, or generate the two starter templates above to see a real, working example." />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Name</Th>
              <Th>Key</Th>
              <Th>Status</Th>
              <Th className="hidden md:table-cell">Workspace</Th>
              <Th className="hidden sm:table-cell">Last updated</Th>
            </Tr>
          </THead>
          <TBody>
            {workflows.map((workflow) => (
              <WorkflowRow key={workflow.id} organizationSlug={organizationSlug} workflow={workflow} workspaceName={workflow.workspaceId ? (workspaceNameById.get(workflow.workspaceId) ?? null) : null} />
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
