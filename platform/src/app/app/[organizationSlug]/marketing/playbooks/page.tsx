import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { listPlaybooksForUser } from "@/lib/marketing-os/playbooks";
import { createMarketingPlaybookAction } from "@/lib/dashboard/actions/marketing";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/dashboard/FormField";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { MARKETING_PLAYBOOK_TYPES } from "@/lib/marketing-os/validation";

export const dynamic = "force-dynamic";

export default async function MarketingPlaybooksPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/marketing/playbooks`);

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

  const playbooks = await listPlaybooksForUser(db, { organizationId, actorUserId: user.userId });

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Marketing", href: `/app/${organizationSlug}/marketing` }, { label: "Playbooks" }]} />
      <PageHeader title="Playbooks" description="Immutable, versioned playbooks — campaign, content creation, review, launch, nurture." />

      <ActionForm action={createMarketingPlaybookAction.bind(null, organizationSlug)} className="flex flex-wrap items-end gap-3 border border-border p-4">
        <FormField label="Playbook key" name="playbookKey" required hint="UPPERCASE_WITH_UNDERSCORES" />
        <FormField label="Name" name="name" required />
        <SelectField label="Type" name="playbookType" options={MARKETING_PLAYBOOK_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, " ") }))} />
        <SubmitButton>Create playbook</SubmitButton>
      </ActionForm>

      {playbooks.length === 0 ? (
        <EmptyState title="No playbooks yet." />
      ) : (
        <ul className="flex flex-col gap-2">
          {playbooks.map((playbook) => (
            <Card as="li" key={playbook.id} padding="sm">
              <Link href={`/app/${organizationSlug}/marketing/playbooks/${playbook.id}`} className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-foreground">{playbook.name}</span>
                  <span className="text-xs text-subtle">{playbook.playbookType.replace(/_/g, " ")}</span>
                </div>
                <Badge tone={playbook.lifecycle === "published" ? "success" : "neutral"}>{playbook.lifecycle}</Badge>
              </Link>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
