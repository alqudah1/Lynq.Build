import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { listPlaybooksForUser } from "@/lib/sales-os/playbooks";
import { listSequencesForUser } from "@/lib/sales-os/sequences";
import { createPlaybookAction, createFollowUpSequenceAction } from "@/lib/dashboard/actions/sales";
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

const LIFECYCLE_TONE: Record<string, BadgeTone> = { draft: "neutral", published: "success", archived: "neutral" };

const PLAYBOOK_TYPE_OPTIONS = [
  { value: "lead_qualification", label: "Lead qualification" },
  { value: "opportunity", label: "Opportunity" },
  { value: "follow_up", label: "Follow-up" },
];

const SEQUENCE_TARGET_OPTIONS = [
  { value: "lead", label: "Lead" },
  { value: "opportunity", label: "Opportunity" },
];

export default async function SalesPlaybooksPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/sales/playbooks`);

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

  const [playbooks, sequences] = await Promise.all([listPlaybooksForUser(db, { organizationId, actorUserId: user.userId }), listSequencesForUser(db, { organizationId, actorUserId: user.userId })]);

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Sales", href: `/app/${organizationSlug}/sales` }, { label: "Playbooks" }]} />
      <PageHeader title="Playbooks & sequences" description="Versioned, structured sales processes — never an executable script an LLM invents at runtime." />

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Playbooks</h2>
        {playbooks.length === 0 ? (
          <EmptyState title="No playbooks yet." />
        ) : (
          <ul className="flex flex-col gap-2">
            {playbooks.map((p) => (
              <li key={p.id}>
                <Card as={Link} href={`/app/${organizationSlug}/sales/playbooks/${p.id}`} interactive padding="sm" className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{p.name}</p>
                    <p className="text-xs text-subtle">{p.playbookType.replace(/_/g, " ")}</p>
                  </div>
                  <Badge tone={LIFECYCLE_TONE[p.lifecycle]}>{p.lifecycle}</Badge>
                </Card>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={createPlaybookAction.bind(null, organizationSlug)} className="flex flex-wrap items-end gap-3 rounded-md border border-border p-4">
          <FormField label="Name" name="name" required />
          <FormField label="Key" name="playbookKey" required hint="uppercase, e.g. STANDARD_QUALIFICATION" />
          <SelectField label="Type" name="playbookType" options={PLAYBOOK_TYPE_OPTIONS} />
          <SubmitButton>Create playbook</SubmitButton>
        </ActionForm>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Follow-up sequences</h2>
        {sequences.length === 0 ? (
          <EmptyState title="No follow-up sequences yet." />
        ) : (
          <ul className="flex flex-col gap-2">
            {sequences.map((s) => (
              <Card as="li" key={s.id} padding="sm" className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{s.name}</p>
                  <p className="text-xs text-subtle">{s.targetType}</p>
                </div>
                <Badge tone={LIFECYCLE_TONE[s.lifecycle]}>{s.lifecycle}</Badge>
              </Card>
            ))}
          </ul>
        )}
        <ActionForm action={createFollowUpSequenceAction.bind(null, organizationSlug)} className="flex flex-wrap items-end gap-3 rounded-md border border-border p-4">
          <FormField label="Name" name="name" required />
          <FormField label="Key" name="sequenceKey" required hint="uppercase, e.g. STANDARD_FOLLOW_UP" />
          <SelectField label="Target" name="targetType" options={SEQUENCE_TARGET_OPTIONS} />
          <SubmitButton>Create sequence</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
