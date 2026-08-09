import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError, AuthzError } from "@/lib/authz/errors";
import { resolveEffectiveFounderConfiguration } from "@/lib/founder-os/configuration";
import { listFounderRoleAssignments } from "@/lib/founder-os/roles";
import { FOUNDER_ROLES } from "@/lib/founder-os/validation";
import { ANALYTICS_DATE_RANGE_STRATEGIES } from "@/lib/analytics-os/validation";
import { seedFounderAnalystAction, grantFounderRoleAction, revokeFounderRoleAction, upsertFounderConfigurationAction } from "@/lib/dashboard/actions/founder";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { FormField } from "@/components/dashboard/FormField";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";

export const dynamic = "force-dynamic";

export default async function FounderSettingsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/founder/settings`);

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

  const config = await resolveEffectiveFounderConfiguration(db, { organizationId, workspaceId: null, actorUserId: user.userId });

  let roleAssignments: Awaited<ReturnType<typeof listFounderRoleAssignments>> = [];
  try {
    roleAssignments = await listFounderRoleAssignments(db, { organizationId, actorUserId: user.userId });
  } catch (err) {
    if (!(err instanceof AuthzError)) throw err;
  }

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Founder", href: `/app/${organizationSlug}/founder` }, { label: "Settings" }]} />
      <PageHeader title="Founder Workspace settings" description="Founder Workspace permission is independent from Analytics/CRM/Sales/Marketing roles, and never bypasses a source module's own privacy." />

      <Card className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Setup</h2>
        <p className="text-sm text-subtle">Seeds the Founder Analyst agent (read-only report generation). Idempotent — safe to run again.</p>
        <ActionForm action={seedFounderAnalystAction.bind(null, organizationSlug)}>
          <SubmitButton pendingLabel="Seeding…">Seed Founder Analyst</SubmitButton>
        </ActionForm>
      </Card>

      <Card padding="md" className="max-w-xl">
        <h2 className="mb-3 text-xs uppercase tracking-[0.1em] text-subtle">Configuration</h2>
        <ActionForm action={upsertFounderConfigurationAction.bind(null, organizationSlug)} className="flex flex-col gap-5">
          <input type="hidden" name="expectedRevision" value={config.revision} />
          <SelectField label="Default date range" name="defaultDateRangeStrategy" defaultValue={config.defaultDateRangeStrategy} options={ANALYTICS_DATE_RANGE_STRATEGIES.map((s) => ({ value: s, label: s }))} />
          <div>
            <SubmitButton pendingLabel="Saving…">Save configuration</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Grant a role</h2>
        <p className="text-sm text-subtle">Founder Workspace access is explicit — CRM/Sales/Marketing/Analytics permissions never automatically grant it.</p>
        <ActionForm action={grantFounderRoleAction.bind(null, organizationSlug)} className="flex flex-col gap-4">
          <FormField label="User ID" name="userId" required placeholder="uuid" />
          <SelectField label="Role" name="role" options={FOUNDER_ROLES.map((r) => ({ value: r, label: r }))} defaultValue="founder_viewer" />
          <div>
            <SubmitButton pendingLabel="Granting…">Grant role</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      {roleAssignments.length > 0 ? (
        <Card className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Current role assignments</h2>
          <ul className="flex flex-col gap-2">
            {roleAssignments.map((assignment) => (
              <li key={assignment.id} className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 last:border-0">
                <span className="text-sm text-muted">{assignment.userId}</span>
                <div className="flex items-center gap-2">
                  <Badge>{assignment.role}</Badge>
                  <ActionForm action={revokeFounderRoleAction.bind(null, organizationSlug)} hiddenFields={{ roleAssignmentId: assignment.id, expectedRevision: assignment.revision }}>
                    <button type="submit" className="text-xs text-danger hover:underline">Revoke</button>
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
