import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { listFounderGoals, computeFounderGoalProgress } from "@/lib/founder-os/goals";
import { listMetrics } from "@/lib/analytics-os/metrics/registry";
import { createFounderGoalAction } from "@/lib/dashboard/actions/founder";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { FormField } from "@/components/dashboard/FormField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";

export const dynamic = "force-dynamic";

export default async function FounderGoalsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/founder/goals`);

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

  const goals = await listFounderGoals(db, { organizationId, actorUserId: user.userId });
  const progressList = await Promise.all(goals.map((g) => computeFounderGoalProgress(db, { organizationId, goalId: g.id, actorUserId: user.userId })));
  const metrics = listMetrics();

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Founder", href: `/app/${organizationSlug}/founder` }, { label: "Goals" }]} />
      <PageHeader eyebrow="Founder Workspace" title="Executive goals" description="Current value is always derived live from Analytics OS — never stored or estimated." />

      <section className="flex flex-col gap-3">
        {progressList.length === 0 ? (
          <Card className="text-sm text-subtle">No goals set yet.</Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {progressList.map(({ goal, currentValue, progressRatio }) => (
              <li key={goal.id}>
                <Card padding="sm" className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-foreground">{goal.title}</span>
                    <Badge tone={goal.status === "completed" ? "success" : goal.status === "missed" ? "danger" : "neutral"}>{goal.status}</Badge>
                  </div>
                  <p className="text-xs text-subtle">{goal.metricKey}: {currentValue ?? "—"} / {goal.targetValue} ({progressRatio !== null ? `${Math.round(progressRatio * 100)}%` : "—"})</p>
                  <p className="text-[0.7rem] text-subtle">{goal.periodStart.toISOString().slice(0, 10)} → {goal.periodEnd.toISOString().slice(0, 10)}</p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">New goal</h2>
        <Card padding="md" className="max-w-2xl">
          <ActionForm action={createFounderGoalAction.bind(null, organizationSlug)} className="flex flex-col gap-4">
            <FormField label="Title" name="title" required />
            <FormField label="Metric key" name="metricKey" required hint={`Available: ${metrics.map((m) => m.definition.metricKey).join(", ")}`} />
            <FormField label="Target value" name="targetValue" type="number" required />
            <FormField label="Period start" name="periodStart" type="date" required />
            <FormField label="Period end" name="periodEnd" type="date" required />
            <FormField label="Owner (user id)" name="ownerUserId" required placeholder="uuid" />
            <div>
              <SubmitButton pendingLabel="Saving…">Create goal</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </section>
    </div>
  );
}
