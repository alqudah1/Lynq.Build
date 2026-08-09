import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listOrganizationMembers } from "@/lib/organizations/memberships";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { listSalesTeams, listSalesTeamMembers } from "@/lib/sales-os/teams";
import { listSalesRoleAssignments } from "@/lib/sales-os/roles";
import { createSalesTeamAction, addSalesTeamMemberAction, grantSalesRoleAction, revokeSalesRoleAction } from "@/lib/dashboard/actions/sales";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { FormField } from "@/components/dashboard/FormField";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

const ROLE_TONE: Record<string, BadgeTone> = { sales_admin: "accent", sales_manager: "info", sales_rep: "neutral", viewer: "neutral" };

const ROLE_OPTIONS = [
  { value: "sales_rep", label: "Sales rep" },
  { value: "sales_manager", label: "Sales manager" },
  { value: "sales_admin", label: "Sales admin" },
  { value: "viewer", label: "Viewer" },
];

const TEAM_ROLE_OPTIONS = [
  { value: "rep", label: "Rep" },
  { value: "manager", label: "Manager" },
  { value: "viewer", label: "Viewer" },
];

export default async function SalesTeamsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/sales/teams`);

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
    listSalesTeams(db, { organizationId, actorUserId: user.userId }),
    listSalesRoleAssignments(db, { organizationId, actorUserId: user.userId }),
    listOrganizationMembers(db, organizationId, user.userId),
  ]);
  const memberNameById = new Map(members.map((m) => [m.userId, m.name ?? m.email]));
  const teamMembersByTeam = new Map(await Promise.all(teams.map(async (t) => [t.id, await listSalesTeamMembers(db, { organizationId, teamId: t.id, actorUserId: user.userId })] as const)));

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Sales", href: `/app/${organizationSlug}/sales` }, { label: "Teams" }]} />
      <PageHeader title="Teams & roles" description="Team membership is operational grouping only — Sales OS capabilities come from an independent role, granted below, never implied by team membership." />

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Sales OS roles</h2>
        {roleAssignments.length === 0 ? (
          <EmptyState title="No Sales OS roles granted yet." description="Organization owners/admins can bootstrap Sales OS without an explicit grant." />
        ) : (
          <ul className="flex flex-col gap-2">
            {roleAssignments.map((r) => (
              <Card as="li" key={r.id} padding="sm" className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">{memberNameById.get(r.userId) ?? r.userId}</span>
                <div className="flex items-center gap-2">
                  <Badge tone={ROLE_TONE[r.role]}>{r.role.replace(/_/g, " ")}</Badge>
                  <ActionForm action={revokeSalesRoleAction.bind(null, organizationSlug, r.id)} hiddenFields={{ expectedRevision: r.revision }}>
                    <SubmitButton variant="danger">Revoke</SubmitButton>
                  </ActionForm>
                </div>
              </Card>
            ))}
          </ul>
        )}
        <ActionForm action={grantSalesRoleAction.bind(null, organizationSlug)} className="flex flex-wrap items-end gap-3 rounded-md border border-border p-4">
          <SelectField label="Member" name="userId" options={members.map((m) => ({ value: m.userId, label: m.name ?? m.email }))} />
          <SelectField label="Role" name="role" options={ROLE_OPTIONS} />
          <SubmitButton>Grant role</SubmitButton>
        </ActionForm>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Teams</h2>
        {teams.length === 0 ? (
          <EmptyState title="No sales teams yet." />
        ) : (
          <div className="flex flex-col gap-4">
            {teams.map((team) => (
              <Card key={team.id} padding="md" className="flex flex-col gap-3">
                <p className="text-sm font-medium text-foreground">{team.name}</p>
                <ul className="flex flex-col gap-1">
                  {(teamMembersByTeam.get(team.id) ?? []).map((member) => (
                    <li key={member.id} className="flex items-center justify-between text-sm text-muted">
                      <span>{memberNameById.get(member.userId) ?? member.userId}</span>
                      <span className="text-xs text-subtle">{member.teamRole}</span>
                    </li>
                  ))}
                </ul>
                <ActionForm action={addSalesTeamMemberAction.bind(null, organizationSlug, team.id)} className="flex flex-wrap items-end gap-2">
                  <SelectField label="Add member" name="userId" options={members.map((m) => ({ value: m.userId, label: m.name ?? m.email }))} />
                  <SelectField label="Team role" name="teamRole" options={TEAM_ROLE_OPTIONS} />
                  <SubmitButton>Add</SubmitButton>
                </ActionForm>
              </Card>
            ))}
          </div>
        )}
        <ActionForm action={createSalesTeamAction.bind(null, organizationSlug)} className="flex flex-wrap items-end gap-3 rounded-md border border-border p-4">
          <FormField label="Team name" name="name" required />
          <FormField label="Team key" name="teamKey" required hint="uppercase, e.g. ENTERPRISE_SALES" />
          <SubmitButton>Create team</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
