import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listOrganizationMembers } from "@/lib/organizations/memberships";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { listSalesTargets, computeTargetProgress } from "@/lib/sales-os/targets";
import { listSalesTeams } from "@/lib/sales-os/teams";
import { createSalesTargetAction } from "@/lib/dashboard/actions/sales";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { FormField } from "@/components/dashboard/FormField";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

const SCOPE_OPTIONS = [
  { value: "individual", label: "Individual" },
  { value: "team", label: "Team" },
];

const METRIC_OPTIONS = [
  { value: "won_revenue", label: "Won revenue" },
  { value: "opportunities_won", label: "Opportunities won" },
  { value: "leads_qualified", label: "Leads qualified" },
  { value: "activities_completed", label: "Activities completed" },
];

export default async function SalesTargetsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/sales/targets`);

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

  const [targets, members, teams] = await Promise.all([listSalesTargets(db, { organizationId, actorUserId: user.userId }), listOrganizationMembers(db, organizationId, user.userId), listSalesTeams(db, { organizationId, actorUserId: user.userId })]);
  const memberNameById = new Map(members.map((m) => [m.userId, m.name ?? m.email]));
  const teamNameById = new Map(teams.map((t) => [t.id, t.name]));

  const progressByTarget = new Map(await Promise.all(targets.map(async (t) => [t.id, await computeTargetProgress(db, { organizationId, targetId: t.id, actorUserId: user.userId })] as const)));

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Sales", href: `/app/${organizationSlug}/sales` }, { label: "Targets" }]} />
      <PageHeader title="Targets" description="Rep and team quotas — historically traceable, never a compensation/commissions calculation." />

      {targets.length === 0 ? (
        <EmptyState title="No targets set yet." />
      ) : (
        <ul className="flex flex-col gap-2">
          {targets.map((target) => {
            const progress = progressByTarget.get(target.id);
            const scopeLabel = target.scopeType === "individual" ? (target.userId ? (memberNameById.get(target.userId) ?? target.userId) : "—") : target.teamId ? (teamNameById.get(target.teamId) ?? target.teamId) : "—";
            return (
              <Card as="li" key={target.id} padding="sm" className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-foreground">
                    {scopeLabel} — {target.metricType.replace(/_/g, " ")}
                  </p>
                  <p className="text-xs text-subtle">
                    {target.periodStart.toLocaleDateString()} – {target.periodEnd.toLocaleDateString()} · target {Number(target.targetValue).toLocaleString()}
                  </p>
                </div>
                {progress ? <ProgressBar percentage={Math.round(Math.min(1, progress.progressRatio) * 100)} /> : null}
              </Card>
            );
          })}
        </ul>
      )}

      <ActionForm action={createSalesTargetAction.bind(null, organizationSlug)} className="flex flex-wrap items-end gap-3 rounded-md border border-border p-4">
        <SelectField label="Scope" name="scopeType" options={SCOPE_OPTIONS} />
        <SelectField label="Member" name="userId" options={members.map((m) => ({ value: m.userId, label: m.name ?? m.email }))} />
        <SelectField label="Team" name="teamId" options={[{ value: "", label: "N/A" }, ...teams.map((t) => ({ value: t.id, label: t.name }))]} />
        <SelectField label="Metric" name="metricType" options={METRIC_OPTIONS} />
        <FormField label="Period start" name="periodStart" type="date" required />
        <FormField label="Period end" name="periodEnd" type="date" required />
        <FormField label="Target value" name="targetValue" type="number" required />
        <SubmitButton>Create target</SubmitButton>
      </ActionForm>
    </div>
  );
}
