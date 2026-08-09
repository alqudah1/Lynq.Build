import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { listTemplatesForUser } from "@/lib/communications-os/templates";
import { COMMUNICATION_CHANNELS } from "@/lib/communications-os/validation";
import { createTemplateAction } from "@/lib/dashboard/actions/communications";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/dashboard/FormField";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { ActionForm } from "@/components/dashboard/ActionForm";

export const dynamic = "force-dynamic";

export default async function TemplatesPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/communications/templates`);

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

  const templates = await listTemplatesForUser(db, { organizationId, actorUserId: user.userId });
  const createTemplate = createTemplateAction.bind(null, organizationSlug);

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Communications", href: `/app/${organizationSlug}/communications` }, { label: "Templates" }]} />
      <PageHeader title="Templates" description="Reusable, versioned message templates — published versions are immutable. A fixed {{variableName}} substitution engine, never arbitrary code." />

      <section className="flex flex-col gap-3">
        {templates.length === 0 ? (
          <EmptyState title="No templates yet." description="Create one below." />
        ) : (
          <ul className="flex flex-col gap-2">
            {templates.map((t) => (
              <li key={t.id}>
                <Card padding="sm" className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-foreground">{t.name}</span>
                    <span className="text-xs text-subtle">{t.channel} · {t.templateKey}</span>
                  </div>
                  <Badge tone={t.status === "published" ? "success" : t.status === "archived" ? "neutral" : "warning"}>{t.status}</Badge>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Create template</h2>
        <Card>
          <ActionForm action={createTemplate} className="flex flex-col gap-4">
            <SelectField label="Channel" name="channel" options={COMMUNICATION_CHANNELS.map((c) => ({ value: c, label: c }))} defaultValue="email" />
            <FormField label="Name" name="name" required />
            <FormField label="Template key" name="templateKey" required placeholder="lowercase-with-hyphens" hint="Unique within this organization." />
            <FormField label="Subject (email only)" name="subjectTemplate" placeholder="{{firstName}}, a quick note" />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="bodyTemplate" className="text-xs uppercase tracking-[0.1em] text-subtle">Body</label>
              <textarea id="bodyTemplate" name="bodyTemplate" required rows={5} className="lynq-transition rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground hover:border-border-strong focus-visible:border-accent/60" />
            </div>
            <div>
              <SubmitButton pendingLabel="Creating…">Create template</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </section>
    </div>
  );
}
