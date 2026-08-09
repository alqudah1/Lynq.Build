import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { getSalesConfiguration } from "@/lib/sales-os/configuration";
import { upsertSalesConfigurationAction } from "@/lib/dashboard/actions/sales";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { FormField } from "@/components/dashboard/FormField";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

const STRATEGY_OPTIONS = [
  { value: "manual", label: "Manual" },
  { value: "round_robin", label: "Round robin" },
  { value: "least_open_leads", label: "Least open leads" },
];

export default async function SalesSettingsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/sales/settings`);

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

  const config = await getSalesConfiguration(db, { organizationId, workspaceId: null, actorUserId: user.userId });

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Sales", href: `/app/${organizationSlug}/sales` }, { label: "Settings" }]} />
      <PageHeader title="Sales settings" description="Organization-level Sales OS configuration." />

      <Card padding="md" className="max-w-xl">
        <ActionForm action={upsertSalesConfigurationAction.bind(null, organizationSlug)} className="flex flex-col gap-5">
          {config ? <input type="hidden" name="expectedRevision" value={config.revision} /> : null}
          <FormField label="Business timezone" name="businessTimezone" defaultValue={config?.businessTimezone ?? "UTC"} required />
          <FormField label="Currency" name="currency" defaultValue={config?.currency ?? "USD"} required />
          <SelectField label="Default lead assignment strategy" name="defaultLeadAssignmentStrategy" defaultValue={config?.defaultLeadAssignmentStrategy ?? "manual"} options={STRATEGY_OPTIONS} />
          <FormField label="Stale lead threshold (days)" name="staleLeadThresholdDays" type="number" defaultValue={String(config?.staleLeadThresholdDays ?? 7)} required />
          <FormField label="Stale opportunity threshold (days)" name="staleOpportunityThresholdDays" type="number" defaultValue={String(config?.staleOpportunityThresholdDays ?? 14)} required />
          <div>
            <SubmitButton>Save settings</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
