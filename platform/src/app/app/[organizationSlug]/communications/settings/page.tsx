import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { seedCommunicationsAction, grantCommunicationRoleAction } from "@/lib/dashboard/actions/communications";
import { COMMUNICATION_ROLES } from "@/lib/communications-os/validation";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { FormField } from "@/components/dashboard/FormField";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { ActionForm } from "@/components/dashboard/ActionForm";

export const dynamic = "force-dynamic";

export default async function CommunicationsSettingsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/communications/settings`);

  let organizationName: string;
  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationName = organization.name;
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const seed = seedCommunicationsAction.bind(null, organizationSlug);
  const grantRole = grantCommunicationRoleAction.bind(null, organizationSlug);

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Communications", href: `/app/${organizationSlug}/communications` }, { label: "Settings" }]} />
      <PageHeader title="Communications settings" description="Seed the Communications Assistant agent and Tool Runtime tools, and manage Communications OS roles — independent from CRM/Sales/Marketing roles." />

      <Card className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Setup</h2>
        <p className="text-sm text-subtle">Idempotent — safe to run again.</p>
        <ActionForm action={seed}>
          <SubmitButton pendingLabel="Seeding…">Seed agent and tools</SubmitButton>
        </ActionForm>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Grant a role</h2>
        <p className="text-sm text-subtle">Sales OS/Marketing OS/CRM permissions never automatically grant Communications sending ability — a role must be explicitly granted here.</p>
        <ActionForm action={grantRole} className="flex flex-col gap-4">
          <FormField label="User ID" name="userId" required placeholder="uuid" />
          <SelectField label="Role" name="role" options={COMMUNICATION_ROLES.map((r) => ({ value: r, label: r }))} defaultValue="communications_agent" />
          <div>
            <SubmitButton pendingLabel="Granting…">Grant role</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
