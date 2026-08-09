import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listOrganizationMembers } from "@/lib/organizations/memberships";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { listMarketingTeams } from "@/lib/marketing-os/teams";
import { listMarketingRoleAssignments } from "@/lib/marketing-os/roles";
import { createMarketingTeamAction, grantMarketingRoleAction, revokeMarketingRoleAction } from "@/lib/dashboard/actions/marketing";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/dashboard/FormField";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { MARKETING_ROLES } from "@/lib/marketing-os/validation";

export const dynamic = "force-dynamic";

export default async function MarketingTeamsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/marketing/teams`);

  let organizationName: string;
  let organizationId: string;
  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationName = organization.name;
    organizationId = organization.id;
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const [teams, roleAssignments, members] = await Promise.all([
    listMarketingTeams(db, { organizationId, actorUserId: user.userId }),
    listMarketingRoleAssignments(db, { organizationId, actorUserId: user.userId }).catch(() => []),
    listOrganizationMembers(db, organizationId, user.userId),
  ]);
  const memberNameById = new Map(members.map((m) => [m.userId, m.name ?? m.email]));

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Marketing", href: `/app/${organizationSlug}/marketing` }, { label: "Teams" }]} />
      <PageHeader title="Marketing teams &amp; roles" description="Explicit Marketing OS capability grants — independent from CRM/Sales/Brain permissions." />

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Teams</h2>
        <ActionForm action={createMarketingTeamAction.bind(null, organizationSlug)} className="flex flex-wrap items-end gap-3 border border-border p-4">
          <FormField label="Team key" name="teamKey" required hint="UPPERCASE_WITH_UNDERSCORES" />
          <FormField label="Name" name="name" required />
          <SubmitButton>Create team</SubmitButton>
        </ActionForm>
        {teams.length === 0 ? (
          <EmptyState title="No teams yet." />
        ) : (
          <ul className="flex flex-col gap-2">
            {teams.map((team) => (
              <Card as="li" key={team.id} padding="sm" className="text-sm text-foreground">
                {team.name}
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Role assignments</h2>
        <ActionForm action={grantMarketingRoleAction.bind(null, organizationSlug)} className="flex flex-wrap items-end gap-3 border border-border p-4">
          <SelectField label="Member" name="userId" options={members.map((m) => ({ value: m.userId, label: m.name ?? m.email }))} />
          <SelectField label="Role" name="role" options={MARKETING_ROLES.map((r) => ({ value: r, label: r.replace(/_/g, " ") }))} />
          <SubmitButton>Grant role</SubmitButton>
        </ActionForm>
        {roleAssignments.length === 0 ? (
          <EmptyState title="No explicit role assignments — org owner/admin can bootstrap Marketing OS regardless." />
        ) : (
          <ul className="flex flex-col gap-2">
            {roleAssignments.map((assignment) => (
              <Card as="li" key={assignment.id} padding="sm" className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-foreground">{memberNameById.get(assignment.userId) ?? assignment.userId}</span>
                <div className="flex items-center gap-2">
                  <Badge tone="info">{assignment.role.replace(/_/g, " ")}</Badge>
                  <ActionForm action={revokeMarketingRoleAction.bind(null, organizationSlug, assignment.id)} hiddenFields={{ expectedRevision: assignment.revision }}>
                    <SubmitButton variant="danger">Revoke</SubmitButton>
                  </ActionForm>
                </div>
              </Card>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
