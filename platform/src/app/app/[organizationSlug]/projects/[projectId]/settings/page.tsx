import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listOrganizationMembers } from "@/lib/organizations/memberships";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { getProjectForUser, getLegalProjectTransitions } from "@/lib/projects/projects";
import { listProjectMembers } from "@/lib/projects/members";
import { resolveProjectAuthContext } from "@/lib/projects/authz";
import {
  updateProjectAction,
  transitionProjectAction,
  addProjectMemberAction,
  changeProjectMemberRoleAction,
  removeProjectMemberAction,
} from "@/lib/dashboard/actions/projects";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { ProjectSettingsForm } from "@/components/dashboard/projects/ProjectSettingsForm";
import { ProjectStatusControl } from "@/components/dashboard/projects/ProjectStatusControl";
import { ProjectMemberRow } from "@/components/dashboard/projects/ProjectMemberRow";
import { AddProjectMemberForm } from "@/components/dashboard/projects/AddProjectMemberForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, THead, TBody, Tr, Th } from "@/components/ui/Table";

export const dynamic = "force-dynamic";

async function loadSettingsData(
  db: ReturnType<typeof createDbClient>,
  organizationSlug: string,
  projectId: string,
  actorUserId: string
) {
  const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, actorUserId);
  const project = await getProjectForUser(db, { organizationId: organization.id, projectId, actorUserId });
  const [members, orgMembers, authCtx] = await Promise.all([
    listProjectMembers(db, { organizationId: organization.id, projectId, actorUserId }),
    listOrganizationMembers(db, organization.id, actorUserId),
    resolveProjectAuthContext(db, { organizationId: organization.id, project: { id: project.id, workspaceId: project.workspaceId }, actorUserId }),
  ]);

  const projectMemberUserIds = new Set(members.map((m) => m.userId));
  const candidates = orgMembers.filter((m) => !projectMemberUserIds.has(m.userId));
  // Mirrors `requireProjectManageAuthority` exactly — settings/members are a project_owner-level floor, one step above project_manager's content authority.
  const canManage =
    authCtx.orgRole === "owner" ||
    authCtx.orgRole === "admin" ||
    (authCtx.isWorkspaceScoped && authCtx.workspaceRole === "manager") ||
    authCtx.projectRole === "project_owner";
  const legalTargets = getLegalProjectTransitions(project.status);

  return { organizationName: organization.name, project, members, candidates, canManage, legalTargets };
}

export default async function ProjectSettingsPage({ params }: { params: Promise<{ organizationSlug: string; projectId: string }> }) {
  const { organizationSlug, projectId } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/projects/${projectId}/settings`);

  let data: Awaited<ReturnType<typeof loadSettingsData>>;
  try {
    data = await loadSettingsData(db, organizationSlug, projectId, user.userId);
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const { organizationName, project, members, candidates, canManage, legalTargets } = data;

  return (
    <div className="flex flex-col gap-10 px-6 py-8 md:px-10">
      <Breadcrumbs
        items={[
          { label: "LYNQ", href: "/app" },
          { label: organizationName, href: `/app/${organizationSlug}` },
          { label: "Projects", href: `/app/${organizationSlug}/projects` },
          { label: project.name, href: `/app/${organizationSlug}/projects/${projectId}` },
          { label: "Settings" },
        ]}
      />

      <PageHeader eyebrow={project.projectKey} title="Project settings" />

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Status</h2>
        {canManage ? (
          <ProjectStatusControl currentStatus={project.status} legalTargets={legalTargets} expectedRevision={project.revision} action={transitionProjectAction.bind(null, organizationSlug, projectId)} />
        ) : (
          <p className="text-sm text-muted">Status: {project.status}</p>
        )}
      </section>

      <section className="flex flex-col gap-3 max-w-xl">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Details</h2>
        {canManage ? (
          <ProjectSettingsForm project={project} action={updateProjectAction.bind(null, organizationSlug, projectId)} />
        ) : (
          <p className="text-sm text-muted">Only the project owner, workspace manager, or an organization admin can edit these settings.</p>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Members</h2>
        <Table>
          <THead>
            <Tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>Actions</Th>
            </Tr>
          </THead>
          <TBody>
            {members.map((member) => (
              <ProjectMemberRow
                key={member.userId}
                name={member.name}
                email={member.email}
                role={member.role}
                canManage={canManage}
                changeRoleAction={changeProjectMemberRoleAction.bind(null, organizationSlug, projectId, member.userId)}
                removeAction={removeProjectMemberAction.bind(null, organizationSlug, projectId, member.userId)}
              />
            ))}
          </TBody>
        </Table>
        {canManage ? <AddProjectMemberForm candidates={candidates} action={addProjectMemberAction.bind(null, organizationSlug, projectId)} /> : null}
      </section>
    </div>
  );
}
