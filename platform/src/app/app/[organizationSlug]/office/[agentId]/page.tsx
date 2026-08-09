import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listWorkspacesForUser } from "@/lib/workspaces/workspaces";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { getAgent } from "@/lib/agents/agents";
import { listExecutionsForUser } from "@/lib/agent-runtime/executions";
import { getAgentOfficeIdentity } from "@/lib/office/view";
import { OfficeCommandCenter } from "@/components/dashboard/office/OfficeCommandCenter";

export const dynamic = "force-dynamic";

const ACTIVE = new Set(["queued", "assigned", "gathering_context", "planning", "reasoning", "waiting", "executing", "delegating", "human_approval", "verifying", "paused"]);

export default async function EmployeeOfficePage({
  params,
}: {
  params: Promise<{ organizationSlug: string; agentId: string }>;
}) {
  const { organizationSlug, agentId } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/office/${agentId}`);

  const data = await (async () => {
    try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    const [agent, executionPage, workspaces] = await Promise.all([
      getAgent(db, { organizationId: organization.id, agentId, actorUserId: user.userId }),
      listExecutionsForUser(db, { organizationId: organization.id, assignedAgentId: agentId, actorUserId: user.userId, limit: 30 }),
      listWorkspacesForUser(db, user.userId),
    ]);
    const identity = getAgentOfficeIdentity(agent);
    const active = executionPage.executions.filter((execution) => ACTIVE.has(execution.status));
    const completed = executionPage.executions.filter((execution) => execution.status === "completed");
    const primaryWorkspace =
      workspaces.find((workspace) => workspace.organizationId === organization.id && workspace.slug === "operations") ??
      workspaces.find((workspace) => workspace.organizationId === organization.id) ??
      null;

      return { organization, agent, executionPage, identity, active, completed, primaryWorkspace };
    } catch (err) {
      if (err instanceof TenantResourceNotFoundError) notFound();
      throw err;
    }
  })();

  const { organization, agent, executionPage, identity, active, completed, primaryWorkspace } = data;

  return (
      <div className="office-floor flex flex-col gap-8 px-5 py-7 md:px-8 lg:px-10 lg:py-9">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-subtle">
          <Link href={`/app/${organizationSlug}`} className="hover:text-foreground">Office</Link>
          <span aria-hidden="true">/</span>
          <span className="text-muted">{identity.title}</span>
        </nav>

        <header className="employee-office-hero">
          <div className="employee-office-hero__monogram" aria-hidden="true">{identity.monogram}</div>
          <div className="min-w-0 flex-1">
            <p className="text-[0.65rem] uppercase tracking-[0.26em] text-accent-foreground">{identity.room}</p>
            <h1 className="mt-2 font-serif text-4xl font-light text-foreground md:text-6xl">{identity.title}</h1>
            <p className="mt-2 text-sm text-muted">{agent.name} · {agent.department.replaceAll("_", " ")}</p>
            <p className="mt-5 max-w-3xl text-sm leading-6 text-muted md:text-base">{agent.purpose}</p>
          </div>
          <span className={`office-presence ${active.length > 0 ? "office-presence--working" : "office-presence--ready"}`}>
            {active.length > 0 ? "Working" : "Ready"}
          </span>
        </header>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="office-stat"><span>Active assignments</span><strong>{active.length}</strong></div>
          <div className="office-stat"><span>Completed work</span><strong>{completed.length}</strong></div>
          <div className="office-stat"><span>Health</span><strong className="capitalize">{agent.healthStatus}</strong></div>
        </div>

        <OfficeCommandCenter
          organizationId={organization.id}
          organizationSlug={organizationSlug}
          workspaceId={primaryWorkspace?.id ?? null}
          preferredAgentId={agent.id}
          employeeTitle={identity.title}
          compact
        />

        <section aria-labelledby="employee-work-heading" className="office-panel">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[0.65rem] uppercase tracking-[0.2em] text-subtle">Desk activity</p>
              <h2 id="employee-work-heading" className="mt-1 font-serif text-2xl font-light text-foreground">Assignments and results</h2>
            </div>
            <span className="text-xs text-subtle">Last 30 executions</span>
          </div>

          {executionPage.executions.length > 0 ? (
            <ol className="mt-5 grid gap-3 lg:grid-cols-2">
              {executionPage.executions.map((execution) => (
                <li key={execution.id} className="rounded-md border border-border bg-black/10 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[0.62rem] uppercase tracking-[0.12em] text-subtle">{execution.status.replaceAll("_", " ")}</span>
                    <time className="text-[0.62rem] text-subtle" dateTime={execution.updatedAt.toISOString()}>
                      {execution.updatedAt.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
                    </time>
                  </div>
                  <p className="mt-3 text-sm leading-5 text-foreground">{execution.goal}</p>
                  <p className="mt-3 line-clamp-2 text-xs leading-5 text-subtle">Success: {execution.successCriteria}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-5 text-sm text-subtle">No assignments yet. Brief this employee above to begin.</p>
          )}
        </section>
      </div>
  );
}
