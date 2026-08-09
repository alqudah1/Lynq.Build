import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { listAudiencesForUser, evaluateAudience } from "@/lib/marketing-os/audiences";
import { createAudienceAction, snapshotAudienceAction } from "@/lib/dashboard/actions/marketing";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/dashboard/FormField";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { MARKETING_AUDIENCE_ENTITY_TYPES } from "@/lib/marketing-os/validation";

export const dynamic = "force-dynamic";

export default async function MarketingAudiencesPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/marketing/audiences`);

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

  const audiences = await listAudiencesForUser(db, { organizationId, actorUserId: user.userId });
  const evaluations = await Promise.all(audiences.map((a) => evaluateAudience(db, { organizationId, audienceId: a.id, actorUserId: user.userId }).catch(() => null)));

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Marketing", href: `/app/${organizationSlug}/marketing` }, { label: "Audiences" }]} />
      <PageHeader title="Audiences" description="Reusable filter definitions over CRM contacts/companies/leads/opportunities — never duplicated people. Evaluation queries CRM live." />

      <ActionForm action={createAudienceAction.bind(null, organizationSlug)} className="flex flex-wrap items-end gap-3 border border-border p-4">
        <FormField label="Audience key" name="audienceKey" required hint="UPPERCASE_WITH_UNDERSCORES" />
        <FormField label="Name" name="name" required />
        <SelectField label="Entity type" name="entityType" options={MARKETING_AUDIENCE_ENTITY_TYPES.map((t) => ({ value: t, label: t }))} />
        <SubmitButton>Create audience</SubmitButton>
      </ActionForm>

      {audiences.length === 0 ? (
        <EmptyState title="No audiences yet." description="Create one above — it starts with no filters (matches every record of its entity type) and can be refined via the API." />
      ) : (
        <ul className="flex flex-col gap-2">
          {audiences.map((audience, i) => (
            <Card as="li" key={audience.id} padding="sm" className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-foreground">{audience.name}</span>
                <span className="text-xs text-subtle">{audience.entityType} · {audience.filterDefinition.length} filter condition(s)</span>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone="info">{evaluations[i]?.count ?? "—"} record(s)</Badge>
                <ActionForm action={snapshotAudienceAction.bind(null, organizationSlug, audience.id)} hiddenFields={{ expectedRevision: audience.revision }}>
                  <SubmitButton variant="glass">Snapshot</SubmitButton>
                </ActionForm>
              </div>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
