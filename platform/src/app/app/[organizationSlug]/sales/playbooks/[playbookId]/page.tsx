import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { getPlaybookForUser, listPlaybookVersions, listPlaybookSteps } from "@/lib/sales-os/playbooks";
import { createPlaybookVersionAction, addPlaybookStepAction, publishPlaybookVersionAction } from "@/lib/dashboard/actions/sales";
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

const VERSION_STATUS_TONE: Record<string, BadgeTone> = { draft: "neutral", published: "success", superseded: "neutral" };

const STEP_TYPE_OPTIONS = [
  { value: "checklist", label: "Checklist" },
  { value: "collect_information", label: "Collect information" },
  { value: "crm_activity_required", label: "CRM activity required" },
  { value: "follow_up_required", label: "Follow-up required" },
  { value: "workflow", label: "Workflow" },
  { value: "approval", label: "Approval" },
  { value: "artifact_required", label: "Artifact required" },
  { value: "stage_recommendation", label: "Stage recommendation" },
  { value: "manual_decision", label: "Manual decision" },
];

export default async function SalesPlaybookDetailPage({ params }: { params: Promise<{ organizationSlug: string; playbookId: string }> }) {
  const { organizationSlug, playbookId } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/sales/playbooks/${playbookId}`);

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
  const draftVersion = versions.find((v) => v.status === "draft") ?? null;
  const draftSteps = draftVersion ? await listPlaybookSteps(db, { organizationId, playbookVersionId: draftVersion.id, actorUserId: user.userId }) : [];

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs
        items={[
          { label: "LYNQ", href: "/app" },
          { label: organizationName, href: `/app/${organizationSlug}` },
          { label: "Sales", href: `/app/${organizationSlug}/sales` },
          { label: "Playbooks", href: `/app/${organizationSlug}/sales/playbooks` },
          { label: playbook.name },
        ]}
      />
      <PageHeader eyebrow={playbook.playbookKey} title={playbook.name} description={`${playbook.playbookType.replace(/_/g, " ")} · ${playbook.lifecycle}`} />

      <section className="flex flex-col gap-4">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Draft version</h2>
        {!draftVersion ? (
          <EmptyState
            title="No draft version."
            action={
              <ActionForm action={createPlaybookVersionAction.bind(null, organizationSlug, playbookId)}>
                <SubmitButton>Create draft version</SubmitButton>
              </ActionForm>
            }
          />
        ) : (
          <Card padding="md" className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <Badge tone={VERSION_STATUS_TONE[draftVersion.status]}>v{draftVersion.versionNumber}</Badge>
              <ActionForm action={publishPlaybookVersionAction.bind(null, organizationSlug, playbookId, draftVersion.id)} hiddenFields={{ expectedRevision: draftVersion.revision }}>
                <SubmitButton>Publish</SubmitButton>
              </ActionForm>
            </div>

            {draftSteps.length === 0 ? (
              <EmptyState title="No steps yet." />
            ) : (
              <ul className="flex flex-col gap-2">
                {draftSteps.map((step) => (
                  <li key={step.id} className="border-b border-border py-2 last:border-b-0">
                    <p className="text-sm text-foreground">
                      {step.sequence}. {step.name}
                    </p>
                    <p className="text-xs text-subtle">
                      {step.stepType.replace(/_/g, " ")} {step.required ? "· required" : "· optional"}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <ActionForm action={addPlaybookStepAction.bind(null, organizationSlug, playbookId, draftVersion.id)} className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
              <FormField label="Step key" name="stepKey" required hint="uppercase, e.g. CONFIRM_BUDGET" />
              <FormField label="Name" name="name" required />
              <SelectField label="Step type" name="stepType" options={STEP_TYPE_OPTIONS} />
              <FormField label="Sequence" name="sequence" type="number" defaultValue={String(draftSteps.length)} required />
              <SubmitButton>Add step</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">All versions</h2>
        <ul className="flex flex-col gap-2">
          {versions.map((v) => (
            <Card as="li" key={v.id} padding="sm" className="flex items-center justify-between gap-3">
              <span className="text-sm text-foreground">v{v.versionNumber}</span>
              <Badge tone={VERSION_STATUS_TONE[v.status]}>{v.status}</Badge>
            </Card>
          ))}
        </ul>
      </section>
    </div>
  );
}
