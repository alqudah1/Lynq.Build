import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { getOpportunityForUser } from "@/lib/crm/opportunities";
import { resolvePipelineById } from "@/lib/crm/pipelines";
import { listStagesForPipeline } from "@/lib/crm/stages";
import { resolveContactById } from "@/lib/crm/contacts";
import { resolveCompanyById } from "@/lib/crm/companies";
import { listActivitiesForUser } from "@/lib/crm/activities";
import { listNotesForUser } from "@/lib/crm/notes";
import { listProjectLinksForCrmEntity } from "@/lib/crm/project-links";
import { listWorkflowExecutionsForCrmEntity } from "@/lib/crm/workflow-integration";
import { moveOpportunityAction, reopenOpportunityAction, createActivityAction, createNoteAction, archiveNoteAction } from "@/lib/dashboard/actions/crm";
import { listOrganizationMembers } from "@/lib/organizations/memberships";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { OpportunityStageControls } from "@/components/dashboard/crm/OpportunityStageControls";
import { CreateActivityForm } from "@/components/dashboard/crm/CreateActivityForm";
import { CreateNoteForm } from "@/components/dashboard/crm/CreateNoteForm";
import { NoteCard } from "@/components/dashboard/crm/NoteCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

const OPPORTUNITY_STATUS_TONE: Record<string, BadgeTone> = {
  open: "info",
  won: "success",
  lost: "danger",
};

export const dynamic = "force-dynamic";

export default async function OpportunityDetailPage({ params }: { params: Promise<{ organizationSlug: string; opportunityId: string }> }) {
  const { organizationSlug, opportunityId } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/crm/opportunities/${opportunityId}`);

  let organizationId: string;
  let organizationName: string;
  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationId = organization.id;
    organizationName = organization.name;
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

  const [pipeline, stages, contact, company, activities, notes, projectLinks, workflowExecutions, members] = await Promise.all([
    resolvePipelineById(db, organizationId, opportunity.pipelineId),
    listStagesForPipeline(db, { organizationId, pipelineId: opportunity.pipelineId, actorUserId: user.userId }),
    opportunity.primaryContactId ? resolveContactById(db, organizationId, opportunity.primaryContactId) : null,
    opportunity.companyId ? resolveCompanyById(db, organizationId, opportunity.companyId) : null,
    listActivitiesForUser(db, { organizationId, actorUserId: user.userId, opportunityId, limit: 50 }),
    listNotesForUser(db, { organizationId, actorUserId: user.userId, opportunityId, limit: 50 }),
    listProjectLinksForCrmEntity(db, { organizationId, crmEntityType: "opportunity", crmEntityId: opportunityId, actorUserId: user.userId }),
    listWorkflowExecutionsForCrmEntity(db, { organizationId, crmEntityKey: "crmOpportunityId", crmEntityId: opportunityId }),
    listOrganizationMembers(db, organizationId, user.userId),
  ]);

  const memberNameById = new Map(members.map((m) => [m.userId, m.name ?? m.email]));
  const currentStage = stages.find((s) => s.id === opportunity.stageId);
  const redirectPath = `/app/${organizationSlug}/crm/opportunities/${opportunityId}`;
  const target = { opportunityId };
  const canManage = true;

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs
        items={[
          { label: "LYNQ", href: "/app" },
          { label: organizationName, href: `/app/${organizationSlug}` },
          { label: "CRM", href: `/app/${organizationSlug}/crm` },
          { label: "Opportunities", href: `/app/${organizationSlug}/crm/opportunities` },
          { label: opportunity.name },
        ]}
      />

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-3xl italic font-light text-foreground">{opportunity.name}</h1>
          <Badge tone={OPPORTUNITY_STATUS_TONE[opportunity.status] ?? "neutral"}>{opportunity.status}</Badge>
        </div>
        <p className="text-sm text-muted">
          {pipeline.name} · {currentStage?.name ?? "—"}
          {opportunity.amount ? ` · ${opportunity.amount} ${opportunity.currency ?? ""}` : ""}
          {opportunity.expectedCloseDate ? ` · expected close ${opportunity.expectedCloseDate.toLocaleDateString()}` : ""}
        </p>
        <p className="text-sm text-muted">
          {contact ? (
            <Link href={`/app/${organizationSlug}/crm/contacts/${contact.id}`} className="lynq-transition text-foreground hover:text-accent-foreground">
              {contact.displayName}
            </Link>
          ) : (
            "No contact"
          )}
          {" · "}
          {company ? (
            <Link href={`/app/${organizationSlug}/crm/companies/${company.id}`} className="lynq-transition text-foreground hover:text-accent-foreground">
              {company.name}
            </Link>
          ) : (
            "No company"
          )}
        </p>
        {opportunity.lostReason ? <p className="mt-1 text-sm text-muted">Lost reason: {opportunity.lostReason}</p> : null}
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Stage</h2>
        <OpportunityStageControls
          status={opportunity.status}
          expectedRevision={opportunity.revision}
          canManage={canManage}
          allStages={stages.map((s) => ({ id: s.id, name: s.name }))}
          openStages={stages.filter((s) => !s.isClosed).map((s) => ({ id: s.id, name: s.name }))}
          moveAction={moveOpportunityAction.bind(null, organizationSlug, opportunityId)}
          reopenAction={reopenOpportunityAction.bind(null, organizationSlug, opportunityId)}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Projects</h2>
        {projectLinks.length === 0 ? <EmptyState title="Not linked to any project." /> : (
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
        {workflowExecutions.length === 0 ? <EmptyState title="No workflow executions reference this opportunity." /> : (
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
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Activities</h2>
        {activities.length === 0 ? <EmptyState title="No activity recorded yet." /> : (
          <ul className="flex flex-col gap-2">
            {activities.map((a) => (
              <Card as="li" key={a.id} padding="sm" className="text-sm text-foreground">
                <span className="capitalize">{a.activityType.replace(/_/g, " ")}</span> — {a.subject ?? a.summary ?? "No details"}
              </Card>
            ))}
          </ul>
        )}
        <CreateActivityForm target={target} redirectPath={redirectPath} action={createActivityAction.bind(null, organizationSlug)} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Notes (internal)</h2>
        {notes.length === 0 ? <EmptyState title="No notes yet." /> : (
          <ul className="flex flex-col gap-2">
            {notes.map((n) => (
              <NoteCard key={n.id} note={n} authorName={memberNameById.get(n.authorUserId) ?? "—"} redirectPath={redirectPath} archiveAction={archiveNoteAction.bind(null, organizationSlug, n.id)} />
            ))}
          </ul>
        )}
        <CreateNoteForm target={target} redirectPath={redirectPath} action={createNoteAction.bind(null, organizationSlug)} />
      </section>
    </div>
  );
}
