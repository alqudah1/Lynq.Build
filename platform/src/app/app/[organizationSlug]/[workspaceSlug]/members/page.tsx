import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { getWorkspaceForAdministration } from "@/lib/workspaces/workspaces";
import { listOrganizationMembers } from "@/lib/organizations/memberships";
import { listWorkspaceMembers } from "@/lib/workspaces/memberships";
import { changeWorkspaceRoleAction, removeWorkspaceMemberAction } from "@/lib/dashboard/actions/workspaces";
import { TenantResourceNotFoundError, InsufficientRoleError } from "@/lib/authz/errors";
import { Breadcrumbs, type Breadcrumb } from "@/components/dashboard/Breadcrumbs";
import { AddWorkspaceMemberForm } from "@/components/dashboard/AddWorkspaceMemberForm";
import { WorkspaceMemberRow } from "@/components/dashboard/WorkspaceMemberRow";

export const dynamic = "force-dynamic";

/**
 * Workspace member management (Step 5B). Reachable only by an explicit
 * workspace manager or an organization owner/admin via the approved
 * override (`getWorkspaceForAdministration`) — opening this page never
 * grants an org owner/admin workspace CONTENT access; it only lets them
 * administer membership, exactly as approved. The "add member" list only
 * ever offers organization members not already in this workspace,
 * identified by email rather than internal user ID — and
 * `addWorkspaceMember` itself still independently re-verifies
 * parent-organization membership regardless. Existing rows' mutations are
 * server actions already bound to each member's ID here, so the row
 * component itself never holds a raw ID prop it could misuse; the bound
 * ID is still part of that row's action-call payload once rendered (see
 * `OrganizationMemberRow`'s comment on why `.bind()` isn't encryption) —
 * the real guarantee is `changeWorkspaceRole`/`removeWorkspaceMember`
 * re-verifying authorization against it independently every time.
 */
export default async function WorkspaceMembersPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; workspaceSlug: string }>;
}) {
  const { organizationSlug, workspaceSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/${workspaceSlug}/members`);

  let organizationName: string;
  let accessDenied = false;
  let workspaceName = "";
  let workspaceMembers: { userId: string; email: string; name: string | null; role: string }[] = [];
  let addCandidates: { name: string | null; email: string }[] = [];

  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationName = organization.name;

    try {
      const { workspace } = await getWorkspaceForAdministration(db, organization.id, workspaceSlug, user.userId);
      workspaceName = workspace.name;

      const [orgMembers, wsMembers] = await Promise.all([
        listOrganizationMembers(db, organization.id, user.userId),
        listWorkspaceMembers(db, workspace.id, organization.id, user.userId),
      ]);
      workspaceMembers = wsMembers;
      const memberIds = new Set(wsMembers.map((m) => m.userId));
      addCandidates = orgMembers.filter((m) => !memberIds.has(m.userId)).map((m) => ({ name: m.name, email: m.email }));
    } catch (err) {
      if (err instanceof InsufficientRoleError) {
        accessDenied = true;
      } else {
        throw err;
      }
    }
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) {
      notFound();
    }
    throw err;
  }

  const breadcrumbBase: Breadcrumb[] = [{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }];

  if (accessDenied) {
    return (
      <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
        <Breadcrumbs items={[...breadcrumbBase, { label: "Members" }]} />
        <p className="text-sm text-muted">
          You don&rsquo;t have permission to administer this workspace. Only its manager, or an organization owner/admin, can.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs
        items={[...breadcrumbBase, { label: workspaceName, href: `/app/${organizationSlug}/${workspaceSlug}` }, { label: "Members" }]}
      />
      <header>
        <h1 className="font-serif text-3xl italic font-light text-foreground">Workspace members</h1>
      </header>

      <section className="flex flex-col gap-3 border-b border-border pb-6">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Add member</h2>
        <AddWorkspaceMemberForm organizationSlug={organizationSlug} workspaceSlug={workspaceSlug} candidates={addCandidates} />
      </section>

      {workspaceMembers.length === 0 ? (
        <p className="text-sm text-muted">No workspace members yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-[0.1em] text-subtle">
                <th className="py-2 pr-4 font-normal">Name</th>
                <th className="py-2 pr-4 font-normal">Email</th>
                <th className="py-2 pr-4 font-normal">Role</th>
                <th className="py-2 font-normal">Actions</th>
              </tr>
            </thead>
            <tbody>
              {workspaceMembers.map((member) => (
                <WorkspaceMemberRow
                  key={member.email}
                  name={member.name}
                  email={member.email}
                  role={member.role}
                  canManage
                  isSelf={member.userId === user.userId}
                  changeRoleAction={changeWorkspaceRoleAction.bind(null, organizationSlug, workspaceSlug, member.userId)}
                  removeAction={removeWorkspaceMemberAction.bind(null, organizationSlug, workspaceSlug, member.userId)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
