import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { getMarketingConfiguration } from "@/lib/marketing-os/configuration";
import { upsertMarketingConfigurationAction, seedMarketingAgentsAndTemplatesAction } from "@/lib/dashboard/actions/marketing";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { FormField } from "@/components/dashboard/FormField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { ActionForm } from "@/components/dashboard/ActionForm";

export const dynamic = "force-dynamic";

export default async function MarketingSettingsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/marketing/settings`);

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

  const config = await getMarketingConfiguration(db, { organizationId, workspaceId: null, actorUserId: user.userId });

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Marketing", href: `/app/${organizationSlug}/marketing` }, { label: "Settings" }]} />
      <PageHeader title="Marketing settings" description="Organization-wide Marketing OS configuration." />

      <ActionForm action={upsertMarketingConfigurationAction.bind(null, organizationSlug)} className="grid gap-4 border border-border p-4 sm:grid-cols-2">
        <FormField label="Business timezone" name="businessTimezone" defaultValue={config?.businessTimezone ?? "UTC"} />
        <FormField label="Default currency" name="defaultCurrency" defaultValue={config?.defaultCurrency ?? "USD"} />
        <FormField label="Stale campaign threshold (days)" name="staleCampaignThresholdDays" type="number" defaultValue={String(config?.staleCampaignThresholdDays ?? 14)} />
        <FormField label="Attribution window (days)" name="attributionWindowDays" type="number" defaultValue={String(config?.attributionWindowDays ?? 30)} />
        {config ? <input type="hidden" name="expectedRevision" value={config.revision} /> : null}
        <div className="sm:col-span-2">
          <SubmitButton>Save configuration</SubmitButton>
        </div>
      </ActionForm>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Agents &amp; workflow templates</h2>
        <p className="text-sm text-muted">Seeds the three Marketing agents (Campaign Brief, Content Draft, Campaign Summary Assistants) and the three starter workflow templates. Idempotent — safe to run again.</p>
        <ActionForm action={seedMarketingAgentsAndTemplatesAction.bind(null, organizationSlug)}>
          <SubmitButton pendingLabel="Seeding…">Seed agents &amp; templates</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
