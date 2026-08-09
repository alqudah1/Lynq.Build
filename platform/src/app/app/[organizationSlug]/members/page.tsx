import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listOrganizationMembers } from "@/lib/organizations/memberships";
import { changeOrganizationRoleAction, removeOrganizationMemberAction } from "@/lib/dashboard/actions/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { OrganizationMemberRow } from "@/components/dashboard/OrganizationMemberRow";

export const dynamic = "force-dynamic";

/**
 * Organization member management (Step 5B). Rows are keyed and rendered
 * from name/email/role, never a raw ID prop the row component itself
 * holds — each row's mutations are server actions already bound to that
 * member's ID here (a bound action's target is never client-chosen). A
 * bound ID is still present in that row's action-call payload once
 * rendered (`.bind()` arguments aren't encrypted, see
 * `OrganizationMemberRow`'s comment) — the real boundary is that
 * `changeOrganizationRole`/`removeOrganizationMember` re-verify
 * authorization against it independently every time, not that the ID is
 * secret.
 */
export default async function OrganizationMembersPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/members`);

  let organizationName: string;
  let role: string;
  let members: { userId: string; email: string; name: string | null; role: string }[];
  try {
    const { organization, membership } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationName = organization.name;
    role = membership.role;
    members = await listOrganizationMembers(db, organization.id, user.userId);
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) {
      notFound();
    }
    throw err;
  }

  const canManage = role === "owner" || role === "admin";

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Members" }]} />
      <header>
        <h1 className="font-serif text-3xl italic font-light text-foreground">Members</h1>
      </header>

      {members.length === 0 ? (
        <p className="text-sm text-muted">No members yet.</p>
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
              {members.map((member) => (
                <OrganizationMemberRow
                  key={member.email}
                  name={member.name}
                  email={member.email}
                  role={member.role}
                  canManage={canManage}
                  isSelf={member.userId === user.userId}
                  changeRoleAction={changeOrganizationRoleAction.bind(null, organizationSlug, member.userId)}
                  removeAction={removeOrganizationMemberAction.bind(null, organizationSlug, member.userId)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
