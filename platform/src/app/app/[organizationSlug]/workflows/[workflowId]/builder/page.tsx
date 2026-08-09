import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { getWorkflowDefinitionForUser } from "@/lib/workflows/definitions";
import { listWorkflowVersions, getWorkflowVersionForUser } from "@/lib/workflows/versions";
import { listWorkflowNodes } from "@/lib/workflows/nodes";
import { listWorkflowEdges } from "@/lib/workflows/edges";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { CreateVersionForm } from "@/components/dashboard/workflows/CreateVersionForm";
import { NodeItem } from "@/components/dashboard/workflows/NodeItem";
import { CreateNodeForm } from "@/components/dashboard/workflows/CreateNodeForm";
import { EdgeItem } from "@/components/dashboard/workflows/EdgeItem";
import { CreateEdgeForm } from "@/components/dashboard/workflows/CreateEdgeForm";
import { ValidationPanel } from "@/components/dashboard/workflows/ValidationPanel";
import { PublishControl } from "@/components/dashboard/workflows/PublishControl";
import { createVersionAction, createNodeAction, updateNodeAction, deleteNodeAction, createEdgeAction, deleteEdgeAction, validateVersionAction, publishVersionAction } from "@/lib/dashboard/actions/workflows";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

async function loadBuilderData(db: ReturnType<typeof createDbClient>, organizationSlug: string, definitionId: string, requestedVersionId: string | undefined, actorUserId: string) {
  const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, actorUserId);
  const definition = await getWorkflowDefinitionForUser(db, { organizationId: organization.id, definitionId, actorUserId });
  const versions = await listWorkflowVersions(db, { organizationId: organization.id, definitionId, actorUserId });

  const targetVersionId = requestedVersionId ?? versions.find((v) => v.status === "draft")?.id ?? versions[0]?.id ?? null;
  if (!targetVersionId) {
    return { organizationName: organization.name, definition, versions, version: null, nodes: [], edges: [] };
  }

  const version = await getWorkflowVersionForUser(db, { organizationId: organization.id, definitionId, versionId: targetVersionId, actorUserId });
  const [nodes, edges] = await Promise.all([
    listWorkflowNodes(db, { organizationId: organization.id, definitionId, versionId: version.id, actorUserId }),
    listWorkflowEdges(db, { organizationId: organization.id, definitionId, versionId: version.id, actorUserId }),
  ]);

  return { organizationName: organization.name, definition, versions, version, nodes, edges };
}

export default async function WorkflowBuilderPage({ params, searchParams }: { params: Promise<{ organizationSlug: string; workflowId: string }>; searchParams: Promise<{ versionId?: string }> }) {
  const { organizationSlug, workflowId } = await params;
  const { versionId: requestedVersionId } = await searchParams;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/workflows/${workflowId}/builder`);

  let data: Awaited<ReturnType<typeof loadBuilderData>>;
  try {
    data = await loadBuilderData(db, organizationSlug, workflowId, requestedVersionId, user.userId);
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const { organizationName, definition, versions, version, nodes, edges } = data;
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const isEditable = version?.status === "draft";

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs
        items={[
          { label: "LYNQ", href: "/app" },
          { label: organizationName, href: `/app/${organizationSlug}` },
          { label: "Workflows", href: `/app/${organizationSlug}/workflows` },
          { label: definition.name, href: `/app/${organizationSlug}/workflows/${workflowId}` },
          { label: "Builder" },
        ]}
      />
      <PageHeader
        title={`${definition.name} — Builder`}
        actions={
          version ? (
            <div className="flex items-center gap-2">
              <Badge tone="neutral">v{version.versionNumber}</Badge>
              <Badge tone={version.status === "published" ? "success" : version.status === "valid" ? "info" : "neutral"}>{version.status}</Badge>
              {!isEditable ? <span className="text-xs text-subtle">Read-only — create a new draft to make changes</span> : null}
            </div>
          ) : undefined
        }
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Version</h2>
        <CreateVersionForm action={createVersionAction.bind(null, organizationSlug, workflowId)} cloneFromVersionId={definition.currentPublishedVersionId ?? undefined} />
        {versions.length > 1 ? (
          <nav aria-label="Switch version" className="flex flex-wrap gap-2 text-sm">
            {versions.map((v) => (
              <a
                key={v.id}
                href={`/app/${organizationSlug}/workflows/${workflowId}/builder?versionId=${v.id}`}
                className={`lynq-transition rounded-sm border px-3 py-1 ${v.id === version?.id ? "border-transparent bg-foreground text-background" : "border-border text-foreground hover:border-border-strong"}`}
              >
                v{v.versionNumber}
              </a>
            ))}
          </nav>
        ) : null}
      </section>

      {version ? (
        <>
          <section className="flex flex-col gap-4">
            <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Nodes</h2>
            {nodes.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {nodes.map((node) => (
                  <NodeItem key={node.id} node={node} canEdit={isEditable} deleteAction={deleteNodeAction.bind(null, organizationSlug, workflowId, version.id, node.id)} updateAction={updateNodeAction.bind(null, organizationSlug, workflowId, version.id, node.id)} />
                ))}
              </ul>
            ) : (
              <EmptyState title="No nodes yet." />
            )}
            {isEditable ? <CreateNodeForm action={createNodeAction.bind(null, organizationSlug, workflowId, version.id)} /> : null}
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Edges</h2>
            {edges.length > 0 ? (
              <ul className="flex flex-col">
                {edges.map((edge) => (
                  <EdgeItem key={edge.id} edge={edge} nodesById={nodesById} canEdit={isEditable} deleteAction={deleteEdgeAction.bind(null, organizationSlug, workflowId, version.id, edge.id)} />
                ))}
              </ul>
            ) : (
              <EmptyState title="No edges yet." />
            )}
            {isEditable ? <CreateEdgeForm nodes={nodes.map((n) => ({ id: n.id, name: n.name }))} action={createEdgeAction.bind(null, organizationSlug, workflowId, version.id)} /> : null}
          </section>

          {isEditable ? (
            <section className="flex flex-col gap-4">
              <ValidationPanel lastResult={version.validationResult} action={validateVersionAction.bind(null, organizationSlug, workflowId, version.id)} />
              <PublishControl canPublish={version.status === "valid"} expectedRevision={version.revision} action={publishVersionAction.bind(null, organizationSlug, workflowId, version.id)} />
            </section>
          ) : null}
        </>
      ) : (
        <EmptyState title="Create a version above to start building this workflow." />
      )}
    </div>
  );
}
