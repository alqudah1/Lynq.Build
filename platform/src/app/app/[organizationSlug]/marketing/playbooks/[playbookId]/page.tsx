import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { getPlaybookForUser, listPlaybookVersions, listPlaybookSteps } from "@/lib/marketing-os/playbooks";
import { addMarketingPlaybookStepAction, publishMarketingPlaybookVersionAction } from "@/lib/dashboard/actions/marketing";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/dashboard/FormField";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { MARKETING_PLAYBOOK_STEP_TYPES } from "@/lib/marketing-os/validation";

export const dynamic = "force-dynamic";

export default async function MarketingPlaybookDetailPage({ params }: { params: Promise<{ organizationSlug: string; playbookId: string }> }) {
  const { organizationSlug, playbookId } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/marketing/playbooks/${playbookId}`);

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

  let playbook;
  try {
    playbook = await getPlaybookForUser(db, { organizationId, playbookId, actorUserId: user.userId });
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const versions = await listPlaybookVersions(db, { organizationId, playbookId, actorUserId: user.userId });
  const draftVersion = versions.find((v) => v.status === "draft") ?? versions[0];
  const steps = draftVersion ? await listPlaybookSteps(db, { organizationId, playbookVersionId: draftVersion.id, actorUserId: user.userId }) : [];

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs
        items={[
          { label: "LYNQ", href: "/app" },
          { label: organizationName, href: `/app/${organizationSlug}` },
          { label: "Marketing", href: `/app/${organizationSlug}/marketing` },
          { label: "Playbooks", href: `/app/${organizationSlug}/marketing/playbooks` },
          { label: playbook.name },
        ]}
      />

      <header className="flex flex-wrap items-center gap-3">
        <h1 className="font-serif text-3xl italic font-light text-foreground">{playbook.name}</h1>
        <Badge tone={playbook.lifecycle === "published" ? "success" : "neutral"}>{playbook.lifecycle}</Badge>
      </header>

      {draftVersion ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Version {draftVersion.versionNumber} ({draftVersion.status})</h2>

          {draftVersion.status === "draft" ? (
            <ActionForm action={addMarketingPlaybookStepAction.bind(null, organizationSlug, playbookId, draftVersion.id)} className="grid gap-3 border border-border p-4 sm:grid-cols-2">
              <FormField label="Step key" name="stepKey" required hint="UPPER_SNAKE_CASE" />
              <FormField label="Name" name="name" required />
              <SelectField label="Step type" name="stepType" options={MARKETING_PLAYBOOK_STEP_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, " ") }))} />
              <FormField label="Sequence" name="sequence" type="number" required />
              <div className="sm:col-span-2">
                <SubmitButton>Add step</SubmitButton>
              </div>
            </ActionForm>
          ) : null}

          {steps.length === 0 ? (
            <EmptyState title="No steps yet." />
          ) : (
            <ul className="flex flex-col gap-2">
              {steps.map((step) => (
                <Card as="li" key={step.id} padding="sm" className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm text-foreground">{step.name}</span>
                  <span className="text-xs text-subtle">{step.stepType.replace(/_/g, " ")} {step.required ? "· required" : "· optional"}</span>
                </Card>
              ))}
            </ul>
          )}

          {draftVersion.status === "draft" && steps.length > 0 ? (
            <ActionForm action={publishMarketingPlaybookVersionAction.bind(null, organizationSlug, playbookId, draftVersion.id)} hiddenFields={{ expectedRevision: draftVersion.revision }}>
              <SubmitButton>Publish version</SubmitButton>
            </ActionForm>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
