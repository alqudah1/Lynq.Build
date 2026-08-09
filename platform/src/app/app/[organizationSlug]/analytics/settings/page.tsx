import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError, AuthzError } from "@/lib/authz/errors";
import { getAnalyticsConfiguration } from "@/lib/analytics-os/configuration";
import { listAnalyticsRoleAssignments } from "@/lib/analytics-os/roles";
import { ANALYTICS_ROLES, ANALYTICS_TIME_GRAINS, ANALYTICS_DATE_RANGE_STRATEGIES } from "@/lib/analytics-os/validation";
import { upsertAnalyticsConfigurationAction, grantAnalyticsRoleAction, revokeAnalyticsRoleAction } from "@/lib/dashboard/actions/analytics";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { FormField } from "@/components/dashboard/FormField";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { ActionForm } from "@/components/dashboard/ActionForm";

export const dynamic = "force-dynamic";

export default async function AnalyticsSettingsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/analytics/settings`);

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

  const config = await getAnalyticsConfiguration(db, { organizationId, workspaceId: null, actorUserId: user.userId });

  let roleAssignments: Awaited<ReturnType<typeof listAnalyticsRoleAssignments>> = [];
  try {
    roleAssignments = await listAnalyticsRoleAssignments(db, { organizationId, actorUserId: user.userId });
  } catch (err) {
    if (!(err instanceof AuthzError)) throw err;
  }

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Analytics", href: `/app/${organizationSlug}/analytics` }, { label: "Settings" }]} />
      <PageHeader title="Analytics settings" description="Business timezone and default query behavior for this organization, and Analytics OS roles — independent from CRM/Sales/Marketing/Communications roles; none of those imply Analytics access." />

      <Card padding="md" className="max-w-xl">
        <h2 className="mb-3 text-xs uppercase tracking-[0.1em] text-subtle">Configuration</h2>
        <ActionForm action={upsertAnalyticsConfigurationAction.bind(null, organizationSlug)} className="flex flex-col gap-5">
          <input type="hidden" name="expectedRevision" value={config?.revision ?? 0} />
          <FormField label="Business timezone (IANA)" name="businessTimezone" defaultValue={config?.businessTimezone ?? "UTC"} required hint="Used to compute day/week/month/quarter boundaries for every date range." />
          <SelectField label="Default time grain" name="defaultTimeGrain" defaultValue={config?.defaultTimeGrain ?? "day"} options={ANALYTICS_TIME_GRAINS.map((g) => ({ value: g, label: g }))} />
          <SelectField label="Default date range" name="defaultDateRangeStrategy" defaultValue={config?.defaultDateRangeStrategy ?? "last_30_days"} options={ANALYTICS_DATE_RANGE_STRATEGIES.map((s) => ({ value: s, label: s }))} />
          <label className="flex items-center gap-2 text-xs text-subtle">
            <input type="checkbox" name="defaultComparisonEnabled" defaultChecked={config?.defaultComparisonEnabled ?? true} />
            Compare to previous period by default
          </label>
          <div>
            <SubmitButton pendingLabel="Saving…">Save configuration</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Grant a role</h2>
        <p className="text-sm text-subtle">Requires Analytics admin (or organization owner/admin). Analytics permission alone never bypasses a source module&rsquo;s own privacy — every metric independently re-checks CRM/Sales/Marketing/Communications/Projects/Workflow/Agent Runtime authority too.</p>
        <ActionForm action={grantAnalyticsRoleAction.bind(null, organizationSlug)} className="flex flex-col gap-4">
          <FormField label="User ID" name="userId" required placeholder="uuid" />
          <SelectField label="Role" name="role" options={ANALYTICS_ROLES.map((r) => ({ value: r, label: r }))} defaultValue="viewer" />
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
                  <ActionForm action={revokeAnalyticsRoleAction.bind(null, organizationSlug)} hiddenFields={{ roleAssignmentId: assignment.id, expectedRevision: assignment.revision }}>
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
