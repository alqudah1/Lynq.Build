import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listWorkspacesForOrganization } from "@/lib/workspaces/workspaces";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { organizationRoleSchema, workspaceRoleSchema } from "@/lib/http/validation";
import { INVITATION_EXPIRY_MS } from "@/lib/invitations/tokens";
import { renderInvitationEmailPreview, isEmailPreviewEnabled } from "@/lib/email/preview";
import { Breadcrumbs, type Breadcrumb } from "@/components/dashboard/Breadcrumbs";

export const dynamic = "force-dynamic";

const SAMPLE_INVITEE_EMAIL = "new.member@example.com";

/** Isolated in its own function so the page component's render body never calls `Date.now()` directly. */
function sampleExpiryDate(): Date {
  return new Date(Date.now() + INVITATION_EXPIRY_MS);
}

/**
 * Owner/admin-only, environment-gated development preview of the
 * invitation email (Step 5C) — lets an organization owner/admin see the
 * rendered branding and wording using their real organization's name and
 * their own name as the sample inviter, WITHOUT any real invitation, raw
 * token, or accept URL ever existing anywhere in this request.
 * `renderInvitationEmailPreview` calls the exact same `renderInvitationEmail`
 * function real delivery will eventually use, but supplies a fixed,
 * non-functional placeholder in place of `acceptUrl` from the very first
 * call — there is no real link to scrub, because one is never generated
 * here.
 *
 * The role/workspace pickers below are a plain `method="get"` form — no
 * client JS, no server action, no mutation of any kind; choosing a
 * different combination just re-requests this same page with different
 * (validated) query parameters. Nothing here is ever persisted.
 */
export default async function InvitationEmailPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ role?: string; workspaceId?: string; workspaceRole?: string }>;
}) {
  const { organizationSlug } = await params;
  const query = await searchParams;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/invitations/preview`);

  let organizationName: string;
  let canPreview = false;
  let workspaces: { id: string; name: string }[] = [];

  try {
    const { organization, membership } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationName = organization.name;
    canPreview = membership.role === "owner" || membership.role === "admin";
    if (canPreview) {
      workspaces = await listWorkspacesForOrganization(db, organization.id, user.userId);
    }
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) {
      notFound();
    }
    throw err;
  }

  const breadcrumbBase: Breadcrumb[] = [
    { label: "LYNQ", href: "/app" },
    { label: organizationName, href: `/app/${organizationSlug}` },
    { label: "Invitations", href: `/app/${organizationSlug}/invitations` },
  ];

  if (!canPreview) {
    return (
      <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
        <Breadcrumbs items={[...breadcrumbBase, { label: "Email preview" }]} />
        <p className="text-sm text-muted">You don&rsquo;t have permission to preview invitation emails. Only organization owners and admins can.</p>
      </div>
    );
  }

  if (!isEmailPreviewEnabled()) {
    return (
      <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
        <Breadcrumbs items={[...breadcrumbBase, { label: "Email preview" }]} />
        <p className="text-sm text-muted">The email preview surface is disabled in this environment.</p>
      </div>
    );
  }

  const parsedRole = organizationRoleSchema.safeParse(query.role);
  const role = parsedRole.success ? parsedRole.data : "member";

  const selectedWorkspace = query.workspaceId ? workspaces.find((ws) => ws.id === query.workspaceId) : undefined;
  const parsedWorkspaceRole = workspaceRoleSchema.safeParse(query.workspaceRole);
  const workspaceRole = selectedWorkspace ? (parsedWorkspaceRole.success ? parsedWorkspaceRole.data : "member") : null;

  const message = renderInvitationEmailPreview({
    to: SAMPLE_INVITEE_EMAIL,
    organizationName,
    inviterName: user.name,
    role,
    workspaceName: selectedWorkspace?.name ?? null,
    workspaceRole,
    expiresAt: sampleExpiryDate(),
  });

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[...breadcrumbBase, { label: "Email preview" }]} />
      <header>
        <h1 className="font-serif text-3xl italic font-light text-foreground">Invitation email preview</h1>
        <p className="mt-2 max-w-prose text-sm text-muted">
          Uses the exact rendering function real delivery will use once Resend is configured. The accept link is never a real, usable URL here.
        </p>
      </header>

      <form method="get" className="flex flex-wrap items-end gap-4 border-b border-border pb-6">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="preview-role" className="text-xs uppercase tracking-[0.1em] text-subtle">
            Organization role
          </label>
          <select
            id="preview-role"
            name="role"
            defaultValue={role}
            className="min-h-11 border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="member">Member</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
        {workspaces.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="preview-workspace" className="text-xs uppercase tracking-[0.1em] text-subtle">
              Workspace (optional)
            </label>
            <select
              id="preview-workspace"
              name="workspaceId"
              defaultValue={selectedWorkspace?.id ?? ""}
              className="min-h-11 border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">No workspace</option>
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <button
          type="submit"
          className="min-h-11 border border-border px-5 text-xs font-medium uppercase tracking-[0.08em] text-foreground transition-opacity hover:opacity-80"
        >
          Update preview
        </button>
      </form>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Subject</h2>
        <p className="text-sm text-foreground">{message.subject}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Rendered email</h2>
        <iframe
          title="Invitation email preview"
          srcDoc={message.html}
          sandbox=""
          className="h-[600px] w-full border border-border bg-white"
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Plain-text version</h2>
        <pre className="whitespace-pre-wrap border border-border bg-elevated p-4 text-sm text-foreground">{message.text}</pre>
      </section>
    </div>
  );
}
