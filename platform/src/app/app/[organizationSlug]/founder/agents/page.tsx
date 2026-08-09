import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { computeExecutiveAgentsView } from "@/lib/founder-os/agents-view";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

export default async function FounderAgentsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/founder/agents`);

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

  const view = await computeExecutiveAgentsView(db, { organizationId, actorUserId: user.userId });

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Founder", href: `/app/${organizationSlug}/founder` }, { label: "AI Workforce" }]} />
      <PageHeader eyebrow="Founder Workspace" title="AI Workforce" description="Real registered agents and their real execution history — no hidden reasoning, no credential values." />

      {view.agents.length === 0 ? (
        <Card className="text-sm text-subtle">No agents are registered yet.</Card>
      ) : (
        <Card padding="sm" className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-[0.1em] text-subtle">
                <th scope="col" className="py-2 pr-4">Agent</th>
                <th scope="col" className="py-2 pr-4">Department</th>
                <th scope="col" className="py-2 pr-4">Lifecycle</th>
                <th scope="col" className="py-2 pr-4">Executions (30d)</th>
                <th scope="col" className="py-2 pr-4">Completed</th>
                <th scope="col" className="py-2 pr-4">Failed</th>
                <th scope="col" className="py-2 pr-4">Success rate</th>
                <th scope="col" className="py-2">Artifacts (30d)</th>
              </tr>
            </thead>
            <tbody>
              {view.agents.map((row) => (
                <tr key={row.agent.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-4 text-foreground">{row.agent.name}</td>
                  <td className="py-2 pr-4 text-muted">{row.agent.department}</td>
                  <td className="py-2 pr-4"><Badge tone={row.agent.lifecycleStage === "retired" ? "danger" : "neutral"}>{row.agent.lifecycleStage}</Badge></td>
                  <td className="py-2 pr-4 text-muted">{row.executionsInPeriod}</td>
                  <td className="py-2 pr-4 text-muted">{row.completed}</td>
                  <td className="py-2 pr-4 text-muted">{row.failed}</td>
                  <td className="py-2 pr-4 text-muted">{row.successRate !== null ? `${row.successRate}%` : "—"}</td>
                  <td className="py-2 text-muted">{row.recentArtifactCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
