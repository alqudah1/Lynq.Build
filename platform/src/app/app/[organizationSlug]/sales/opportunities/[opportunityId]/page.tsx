import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { getOpportunityForUser } from "@/lib/crm/opportunities";
import { listActivitiesForUser } from "@/lib/crm/activities";
import { listFollowUpsForUser } from "@/lib/crm/follow-ups";
import { listProjectLinksForCrmEntity } from "@/lib/crm/project-links";
import { listWorkflowExecutionsForCrmEntity } from "@/lib/crm/workflow-integration";
import { computeOpportunityHealth } from "@/lib/sales-os/health";
import { listOpportunityPlaybookRunsForOpportunity, listOpportunityPlaybookItems } from "@/lib/sales-os/opportunity-playbooks";
import { listApprovalLinksForEntity } from "@/lib/sales-os/approvals";
import {
  startOpportunityPlaybookRunAction,
  completeOpportunityPlaybookItemAction,
  completeOpportunityPlaybookRunAction,
  setOpportunityForecastCategoryAction,
  launchOpportunitySummaryAction,
  requestOpportunityContinuationApprovalAction,
} from "@/lib/dashboard/actions/sales";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, BadgeTone> = { open: "info", won: "success", lost: "danger" };
const HEALTH_TONE: Record<string, BadgeTone> = { healthy: "success", attention: "warning", at_risk: "danger" };
const RUN_STATUS_TONE: Record<string, BadgeTone> = { active: "info", completed: "success", abandoned: "neutral" };

const FORECAST_CATEGORY_OPTIONS = [
  { value: "pipeline", label: "Pipeline" },
  { value: "best_case", label: "Best case" },
  { value: "commit", label: "Commit" },
  { value: "closed", label: "Closed" },
];

export default async function SalesOpportunityDetailPage({ params }: { params: Promise<{ organizationSlug: string; opportunityId: string }> }) {
  const { organizationSlug, opportunityId } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/sales/opportunities/${opportunityId}`);

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

  let opportunity;
  try {
    opportunity = await getOpportunityForUser(db, { organizationId, opportunityId, actorUserId: user.userId });
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const [activities, followUps, projectLinks, workflowExecutions, health, playbookRuns, approvalLinks] = await Promise.all([
    listActivitiesForUser(db, { organizationId, actorUserId: user.userId, opportunityId, limit: 20 }),
    listFollowUpsForUser(db, { organizationId, actorUserId: user.userId, opportunityId, limit: 20 }),
    listProjectLinksForCrmEntity(db, { organizationId, crmEntityType: "opportunity", crmEntityId: opportunityId, actorUserId: user.userId }),
    listWorkflowExecutionsForCrmEntity(db, { organizationId, crmEntityKey: "crmOpportunityId", crmEntityId: opportunityId }),
    computeOpportunityHealth(db, { organizationId, opportunityId, actorUserId: user.userId }),
    listOpportunityPlaybookRunsForOpportunity(db, { organizationId, opportunityId, actorUserId: user.userId }),
    listApprovalLinksForEntity(db, { organizationId, linkedEntityType: "opportunity", linkedEntityId: opportunityId, actorUserId: user.userId }),
  ]);

  const activeRun = playbookRuns.find((r) => r.status === "active") ?? null;
  const activeRunItems = activeRun ? await listOpportunityPlaybookItems(db, organizationId, activeRun.id) : [];

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs
        items={[
          { label: "LYNQ", href: "/app" },
          { label: organizationName, href: `/app/${organizationSlug}` },
          { label: "Sales", href: `/app/${organizationSlug}/sales` },
          { label: "Opportunities", href: `/app/${organizationSlug}/sales/opportunities` },
          { label: opportunity.name },
        ]}
      />

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-3xl italic font-light text-foreground">{opportunity.name}</h1>
          <Badge tone={STATUS_TONE[opportunity.status] ?? "neutral"}>{opportunity.status}</Badge>
          <Badge tone={HEALTH_TONE[health.status]}>{health.status.replace(/_/g, " ")}</Badge>
        </div>
        <p className="text-sm text-muted">{opportunity.amount ? `${opportunity.amount} ${opportunity.currency ?? ""}` : "No amount recorded"}</p>
        {health.reasons.length > 0 ? <p className="text-xs text-subtle">Health reasons: {health.reasons.map((r) => r.replace(/_/g, " ")).join(", ")}</p> : null}
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Forecast category</h2>
        <ActionForm action={setOpportunityForecastCategoryAction.bind(null, organizationSlug, opportunityId)} className="flex flex-wrap items-end gap-2">
          <SelectField label="Forecast category" name="forecastCategory" options={FORECAST_CATEGORY_OPTIONS} />
          <SubmitButton>Save</SubmitButton>
        </ActionForm>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Agent assistance</h2>
        <div className="flex flex-wrap gap-3">
          <ActionForm action={launchOpportunitySummaryAction.bind(null, organizationSlug, opportunityId)}>
            <SubmitButton variant="glass" pendingLabel="Summarizing…">
              Launch opportunity summary
            </SubmitButton>
          </ActionForm>
          <ActionForm action={requestOpportunityContinuationApprovalAction.bind(null, organizationSlug, opportunityId)} className="flex flex-wrap items-end gap-2" hiddenFields={{ summary: "Confirm whether to continue pursuing this opportunity." }}>
            <SubmitButton variant="glass" pendingLabel="Requesting…">
              Request continuation approval
            </SubmitButton>
          </ActionForm>
        </div>
        {approvalLinks.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {approvalLinks.map((link) => (
              <Card as="li" key={link.id} padding="sm" className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">{link.approval.requestedAction}</span>
                <Badge tone={link.approval.status === "pending" ? "warning" : link.approval.status === "approved" ? "success" : "neutral"}>{link.approval.status}</Badge>
              </Card>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Opportunity playbook</h2>
        {playbookRuns.length === 0 ? (
          <EmptyState
            title="No playbook run started yet."
            action={
              <ActionForm action={startOpportunityPlaybookRunAction.bind(null, organizationSlug, opportunityId)}>
                <SubmitButton>Start playbook</SubmitButton>
              </ActionForm>
            }
          />
        ) : (
          <Card padding="md" className="flex flex-col gap-4">
            {activeRun ? (
              <>
                <div className="flex items-center justify-between">
                  <Badge tone={RUN_STATUS_TONE[activeRun.status]}>{activeRun.status}</Badge>
                  <ActionForm action={completeOpportunityPlaybookRunAction.bind(null, organizationSlug, opportunityId, activeRun.id)} hiddenFields={{ expectedRevision: activeRun.revision }}>
                    <SubmitButton>Mark complete</SubmitButton>
                  </ActionForm>
                </div>
                {activeRunItems.length === 0 ? (
                  <EmptyState title="This playbook version has no steps." />
                ) : (
                  <ul className="flex flex-col gap-2">
                    {activeRunItems.map((item) => (
                      <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2 last:border-b-0">
                        <div>
                          <p className="text-sm text-foreground">{item.step.name}</p>
                          <p className="text-xs text-subtle">{item.step.stepType.replace(/_/g, " ")}</p>
                        </div>
                        {item.status === "pending" ? (
                          <div className="flex gap-2">
                            <ActionForm action={completeOpportunityPlaybookItemAction.bind(null, organizationSlug, opportunityId, item.id)} hiddenFields={{ status: "complete" }}>
                              <SubmitButton>Complete</SubmitButton>
                            </ActionForm>
                            <ActionForm action={completeOpportunityPlaybookItemAction.bind(null, organizationSlug, opportunityId, item.id)} hiddenFields={{ status: "skipped" }}>
                              <SubmitButton variant="glass">Skip</SubmitButton>
                            </ActionForm>
                          </div>
                        ) : (
                          <Badge tone={item.status === "complete" ? "success" : "neutral"}>{item.status}</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-sm text-muted">No active playbook run.</p>
            )}
          </Card>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Projects</h2>
        {projectLinks.length === 0 ? (
          <EmptyState title="Not linked to any project." />
        ) : (
          <ul className="flex flex-col gap-2">
            {projectLinks.map((l) => (
              <Card as="li" key={l.id} padding="sm" className="text-sm">
                <Link href={`/app/${organizationSlug}/projects/${l.projectId}`} className="lynq-transition text-foreground hover:text-accent-foreground">
                  Linked project
                </Link>
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Workflow executions</h2>
        {workflowExecutions.length === 0 ? (
          <EmptyState title="No workflow executions reference this opportunity." />
        ) : (
          <ul className="flex flex-col gap-2">
            {workflowExecutions.map((e) => (
              <Card as="li" key={e.id} padding="sm" className="text-sm">
                <Link href={`/app/${organizationSlug}/workflow-executions/${e.id}`} className="lynq-transition capitalize text-foreground hover:text-accent-foreground">
                  {e.status}
                </Link>
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">CRM activity</h2>
        {activities.length === 0 ? (
          <EmptyState title="No activity recorded yet." />
        ) : (
          <ul className="flex flex-col gap-2">
            {activities.map((a) => (
              <Card as="li" key={a.id} padding="sm" className="text-sm text-foreground">
                <span className="capitalize">{a.activityType.replace(/_/g, " ")}</span> — {a.subject ?? a.summary ?? "No details"}
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Follow-ups</h2>
        {followUps.length === 0 ? (
          <EmptyState title="No follow-ups yet." />
        ) : (
          <ul className="flex flex-col gap-2">
            {followUps.map((f) => (
              <Card as="li" key={f.id} padding="sm" className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">{f.title}</span>
                <Badge tone={f.status === "open" ? "warning" : f.status === "completed" ? "success" : "neutral"}>{f.status}</Badge>
              </Card>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
