import Link from "next/link";
import { notFound } from "next/navigation";
import { inArray } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users } from "@/db/schema";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listWorkspacesForUser } from "@/lib/workspaces/workspaces";
import { listProjectsForUser } from "@/lib/projects/projects";
import { calculateProjectProgress } from "@/lib/projects/progress";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { ProjectRow } from "@/components/dashboard/projects/ProjectRow";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, THead, TBody, Tr, Th } from "@/components/ui/Table";

export const dynamic = "force-dynamic";

/**
 * The shared LYNQ project list (Module 10) — every real project this
 * organization is running, including the future Kids Coding and Home
 * Renovation Rebate projects, once created. Nothing about either of
 * those is hardcoded here; this page renders whatever `projects` rows
 * actually exist.
 */
export default async function ProjectsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/projects`);

  let organizationName: string;
  let projects: Awaited<ReturnType<typeof listProjectsForUser>>;
  let workspaceNameById: Map<string, string>;
  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationName = organization.name;
    projects = await listProjectsForUser(db, { organizationId: organization.id, actorUserId: user.userId });
    const workspaces = await listWorkspacesForUser(db, user.userId);
    workspaceNameById = new Map(workspaces.filter((w) => w.organizationId === organization.id).map((w) => [w.id, w.name]));
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const withProgress = await Promise.all(
    projects.map(async (project) => ({ project, progress: await calculateProjectProgress(db, project.organizationId, project.id) }))
  );
  const ownerIds = [...new Set(projects.map((p) => p.ownerUserId))];
  const owners = ownerIds.length > 0 ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, ownerIds)) : [];
  const ownerNameById = new Map(owners.map((o) => [o.id, o.name ?? o.email]));

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Projects" }]} />
      <PageHeader
        title="Projects"
        description="Open a project to see its tasks, employee handoffs, workflow activity, and approvals."
        actions={
          <Link href={`/app/${organizationSlug}/projects/new`} className="lynq-transition flex min-h-11 items-center rounded-sm bg-foreground px-5 text-xs font-medium uppercase tracking-[0.08em] text-background hover:opacity-90">
            New project
          </Link>
        }
      />

      {projects.length === 0 ? (
        <EmptyState title="No projects yet." description="Create the first one to get started." />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Name</Th>
              <Th>Key</Th>
              <Th>Status</Th>
              <Th className="hidden sm:table-cell">Priority</Th>
              <Th className="hidden md:table-cell">Owner</Th>
              <Th className="hidden lg:table-cell">Workspace</Th>
              <Th className="hidden lg:table-cell">Target date</Th>
              <Th>Progress</Th>
            </Tr>
          </THead>
          <TBody>
            {withProgress.map(({ project, progress }) => (
              <ProjectRow
                key={project.id}
                organizationSlug={organizationSlug}
                project={project}
                progress={progress}
                ownerName={ownerNameById.get(project.ownerUserId) ?? "—"}
                workspaceName={project.workspaceId ? (workspaceNameById.get(project.workspaceId) ?? null) : null}
              />
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
