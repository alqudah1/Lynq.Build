import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { listFounderDecisions } from "@/lib/founder-os/decisions";
import { FOUNDER_DECISION_STATUSES } from "@/lib/founder-os/validation";
import { createFounderDecisionAction, updateFounderDecisionStatusAction } from "@/lib/dashboard/actions/founder";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { FormField } from "@/components/dashboard/FormField";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, BadgeTone> = { proposed: "info", decided: "success", superseded: "neutral", archived: "neutral" };

export default async function FounderDecisionsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/founder/decisions`);

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

  const decisions = await listFounderDecisions(db, { organizationId, actorUserId: user.userId });
  const updateStatus = updateFounderDecisionStatusAction.bind(null, organizationSlug);

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Founder", href: `/app/${organizationSlug}/founder` }, { label: "Decisions" }]} />
      <PageHeader eyebrow="Founder Workspace" title="Decision log" description="A real business decision record — never hidden reasoning or chain-of-thought." />

      <section className="flex flex-col gap-3">
        {decisions.length === 0 ? (
          <Card className="text-sm text-subtle">No decisions recorded yet.</Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {decisions.map((d) => (
              <li key={d.id}>
                <Card padding="sm" className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-foreground">{d.title}</span>
                    <Badge tone={STATUS_TONE[d.status] ?? "neutral"}>{d.status}</Badge>
                  </div>
                  <p className="text-xs text-subtle">{d.decision}</p>
                  {d.contextSummary ? <p className="text-[0.7rem] text-subtle">{d.contextSummary}</p> : null}
                  <p className="text-[0.7rem] text-subtle">{d.decisionDate.toISOString().slice(0, 10)}</p>
                  {d.status !== "superseded" && d.status !== "archived" ? (
                    <ActionForm action={updateStatus} hiddenFields={{ decisionId: d.id, expectedRevision: d.revision }} className="flex items-center gap-2">
                      <SelectField label="Status" name="status" defaultValue={d.status} options={FOUNDER_DECISION_STATUSES.map((s) => ({ value: s, label: s }))} />
                      <SubmitButton variant="glass" pendingLabel="Saving…">Update status</SubmitButton>
                    </ActionForm>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">New decision</h2>
        <Card padding="md" className="max-w-2xl">
          <ActionForm action={createFounderDecisionAction.bind(null, organizationSlug)} className="flex flex-col gap-4">
            <FormField label="Title" name="title" required />
            <FormField label="Decision" name="decision" required />
            <FormField label="Context summary" name="contextSummary" />
            <FormField label="Decision owner (user id)" name="decisionOwnerUserId" required placeholder="uuid" />
            <div>
              <SubmitButton pendingLabel="Saving…">Record decision</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </section>
    </div>
  );
}
