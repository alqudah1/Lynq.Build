import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { computeExecutiveProjectsView } from "@/lib/founder-os/projects-view";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/analytics/MetricCard";

export const dynamic = "force-dynamic";

export default async function FounderProjectsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/founder/projects`);

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

  const view = await computeExecutiveProjectsView(db, { organizationId, workspaceId: null, actorUserId: user.userId });

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Founder", href: `/app/${organizationSlug}/founder` }, { label: "Projects" }]} />
      <PageHeader eyebrow="Founder Workspace" title="Executive Projects / Delivery view" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {view.metrics.map((metric) => (
          <MetricCard key={metric.metricKey} metric={metric} />
        ))}
      </div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card padding="md">
          <p className="text-xs uppercase tracking-[0.15em] text-subtle">Recently completed milestones (14 days)</p>
          {view.recentlyCompletedMilestones.length === 0 ? (
            <p className="text-sm text-subtle">None yet.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1">
              {view.recentlyCompletedMilestones.map((m) => (
                <li key={m.id} className="text-sm text-foreground">{m.title} — {m.completedAt.slice(0, 10)}</li>
              ))}
            </ul>
          )}
        </Card>
        <Card padding="md">
          <p className="text-xs uppercase tracking-[0.15em] text-subtle">Project-linked workflow failures</p>
          <p className="font-serif text-2xl italic font-light text-foreground">{view.linkedWorkflowFailures}</p>
        </Card>
      </section>
    </div>
  );
}
