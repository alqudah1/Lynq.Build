import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listOrganizationInvitations, type InvitationListItem } from "@/lib/invitations/invitations";
import { listWorkspacesForOrganization, type WorkspaceOption } from "@/lib/workspaces/workspaces";
import { createOrRefreshInvitationAction, revokeInvitationAction } from "@/lib/dashboard/actions/invitations";
import { TenantResourceNotFoundError, InsufficientRoleError } from "@/lib/authz/errors";
import { Breadcrumbs, type Breadcrumb } from "@/components/dashboard/Breadcrumbs";
import { CreateInvitationForm } from "@/components/dashboard/CreateInvitationForm";
import { InvitationRow } from "@/components/dashboard/InvitationRow";

export const dynamic = "force-dynamic";

const ORGANIZATION_ROLE_OPTIONS = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
];

/**
 * Organization invitation management (Step 5C). Reachable only by an
 * organization owner or admin — `listOrganizationInvitations` itself
 * requires that role just to VIEW the list (unlike organization settings,
 * there is no read-only fallback view for a member/viewer to fall back
 * to), so a member/viewer sees a clear permission message here instead of
 * any invitation content at all.
 *
 * `availableRoles` reflects the actor's own authority (an admin's list
 * never includes "owner") — a UX convenience only; `createOrRefreshInvitation`
 * itself still independently enforces "an admin cannot invite an owner"
 * regardless of what this page happens to render.
 */
export default async function OrganizationInvitationsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/invitations`);

  let organizationName: string;
  let accessDenied = false;
  let invitations: InvitationListItem[] = [];
  let workspaces: WorkspaceOption[] = [];
  let availableRoles = ORGANIZATION_ROLE_OPTIONS;

  try {
    const { organization, membership } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationName = organization.name;

    try {
      invitations = await listOrganizationInvitations(db, organization.id, user.userId);
      workspaces = await listWorkspacesForOrganization(db, organization.id, user.userId);
      availableRoles = membership.role === "owner" ? ORGANIZATION_ROLE_OPTIONS : ORGANIZATION_ROLE_OPTIONS.filter((r) => r.value !== "owner");
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
        <Breadcrumbs items={[...breadcrumbBase, { label: "Invitations" }]} />
        <p className="text-sm text-muted">You don&rsquo;t have permission to manage invitations. Only organization owners and admins can.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[...breadcrumbBase, { label: "Invitations" }]} />
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-serif text-3xl italic font-light text-foreground">Invitations</h1>
        <Link
          href={`/app/${organizationSlug}/invitations/preview`}
          className="text-xs uppercase tracking-[0.08em] text-muted underline-offset-4 hover:underline"
        >
          Preview invitation email
        </Link>
      </header>

      <section className="flex flex-col gap-4 border-b border-border pb-8">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Invite someone</h2>
        <CreateInvitationForm organizationSlug={organizationSlug} availableRoles={availableRoles} workspaces={workspaces} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">All invitations</h2>
        {invitations.length === 0 ? (
          <p className="text-sm text-muted">No invitations yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-[0.1em] text-subtle">
                  <th className="py-2 pr-4 font-normal">Email</th>
                  <th className="py-2 pr-4 font-normal">Role</th>
                  <th className="py-2 pr-4 font-normal">Workspace</th>
                  <th className="py-2 pr-4 font-normal">Status</th>
                  <th className="py-2 pr-4 font-normal">Expires</th>
                  <th className="py-2 pr-4 font-normal">Invited by</th>
                  <th className="py-2 font-normal">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => (
                  <InvitationRow
                    key={`${invitation.email}-${invitation.status}-${invitation.createdAt.toISOString()}`}
                    email={invitation.email}
                    role={invitation.role}
                    workspaceId={invitation.workspaceId}
                    workspaceName={invitation.workspaceName}
                    workspaceRole={invitation.workspaceRole}
                    status={invitation.status}
                    expiresAt={invitation.expiresAt.toISOString()}
                    invitedByName={invitation.invitedByName}
                    resendAction={createOrRefreshInvitationAction.bind(null, organizationSlug)}
                    revokeAction={
                      invitation.status === "pending" ? revokeInvitationAction.bind(null, organizationSlug, invitation.id) : undefined
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
