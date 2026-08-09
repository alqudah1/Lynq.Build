import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listOrganizationMembers } from "@/lib/organizations/memberships";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { getLeadForUser } from "@/lib/crm/leads";
import { resolveContactById } from "@/lib/crm/contacts";
import { resolveCompanyById } from "@/lib/crm/companies";
import { listActivitiesForUser } from "@/lib/crm/activities";
import { listFollowUpsForUser } from "@/lib/crm/follow-ups";
import { listQualificationRunsForLead, listQualificationItems } from "@/lib/sales-os/qualification";
import { resolveSalesAuthContext, requireSalesLeadQualificationAuthority } from "@/lib/sales-os/authz";
import {
  assignLeadAction,
  autoAssignLeadAction,
  startQualificationRunAction,
  completeQualificationItemAction,
  qualifyLeadViaRunAction,
  disqualifyLeadViaRunAction,
  launchLeadResearchAction,
} from "@/lib/dashboard/actions/sales";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, BadgeTone> = {
  new: "neutral",
  contacted: "info",
  engaged: "info",
  qualified: "accent",
  disqualified: "danger",
  converted: "success",
};

const RUN_STATUS_TONE: Record<string, BadgeTone> = {
  not_started: "neutral",
  in_progress: "info",
  waiting: "warning",
  qualified: "success",
  disqualified: "danger",
  abandoned: "neutral",
};

export default async function SalesLeadDetailPage({ params }: { params: Promise<{ organizationSlug: string; leadId: string }> }) {
  const { organizationSlug, leadId } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/sales/leads/${leadId}`);

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

  let lead;
  try {
    lead = await getLeadForUser(db, { organizationId, leadId, actorUserId: user.userId });
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const [contact, company, activities, followUps, runs, members] = await Promise.all([
    lead.contactId ? resolveContactById(db, organizationId, lead.contactId) : null,
    lead.companyId ? resolveCompanyById(db, organizationId, lead.companyId) : null,
    listActivitiesForUser(db, { organizationId, actorUserId: user.userId, leadId, limit: 20 }),
    listFollowUpsForUser(db, { organizationId, actorUserId: user.userId, leadId, limit: 20 }),
    listQualificationRunsForLead(db, { organizationId, leadId, actorUserId: user.userId }),
    listOrganizationMembers(db, organizationId, user.userId),
  ]);

  const memberNameById = new Map(members.map((m) => [m.userId, m.name ?? m.email]));
  const activeRun = runs.find((r) => r.status === "in_progress" || r.status === "waiting") ?? null;
  const activeRunItems = activeRun ? await listQualificationItems(db, organizationId, activeRun.id) : [];

  // Module 14 — server-side gates remain authoritative; this only decides
  // what the page SHOWS (the real button vs. the actual blocking reason),
  // never grants anything the qualify/disqualify server actions wouldn't
  // themselves also independently re-check.
  let qualificationBlockedReason: string | null = null;
  if (activeRun) {
    try {
      const salesCtx = await resolveSalesAuthContext(db, { organizationId, actorUserId: user.userId });
      await requireSalesLeadQualificationAuthority(db, salesCtx, { id: lead.id, ownerUserId: lead.ownerUserId });
    } catch {
      qualificationBlockedReason = "You're not authorized to qualify or disqualify this lead — only its assigned rep, their team manager, or an organization admin may.";
    }
  }
  const checklistIncomplete = Boolean(activeRun && activeRun.missingInformation.length > 0);

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Sales", href: `/app/${organizationSlug}/sales` }, { label: "Leads", href: `/app/${organizationSlug}/sales/leads` }, { label: lead.id.slice(0, 8) }]} />

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-3xl italic font-light text-foreground">Lead {lead.id.slice(0, 8)}</h1>
          <Badge tone={STATUS_TONE[lead.status] ?? "neutral"}>{lead.status}</Badge>
        </div>
        <p className="text-sm text-muted">
          {contact ? (
            <Link href={`/app/${organizationSlug}/crm/contacts/${contact.id}`} className="lynq-transition text-foreground hover:text-accent-foreground">
              {contact.displayName}
            </Link>
          ) : (
            "No contact linked"
          )}
          {" · "}
          {company ? (
            <Link href={`/app/${organizationSlug}/crm/companies/${company.id}`} className="lynq-transition text-foreground hover:text-accent-foreground">
              {company.name}
            </Link>
          ) : (
            "No company linked"
          )}
          {" · "}
          {lead.ownerUserId ? `Owner: ${memberNameById.get(lead.ownerUserId) ?? "—"}` : "Unassigned"}
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Assignment</h2>
        <div className="flex flex-wrap items-center gap-3">
          <ActionForm action={assignLeadAction.bind(null, organizationSlug, leadId)} className="flex flex-wrap items-end gap-2">
            <SelectField label="Assign to" name="assigneeUserId" options={members.map((m) => ({ value: m.userId, label: m.name ?? m.email }))} />
            <SubmitButton>Assign</SubmitButton>
          </ActionForm>
          <ActionForm action={autoAssignLeadAction.bind(null, organizationSlug, leadId)}>
            <SubmitButton variant="glass">Auto-assign</SubmitButton>
          </ActionForm>
          <ActionForm action={launchLeadResearchAction.bind(null, organizationSlug, leadId)}>
            <SubmitButton variant="glass" pendingLabel="Researching…">
              Launch lead research
            </SubmitButton>
          </ActionForm>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Qualification</h2>
        {runs.length === 0 ? (
          <EmptyState
            title="No qualification run started yet."
            action={
              <ActionForm action={startQualificationRunAction.bind(null, organizationSlug, leadId)}>
                <SubmitButton>Start qualification</SubmitButton>
              </ActionForm>
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {activeRun ? (
              <Card padding="md" className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                  <Badge tone={RUN_STATUS_TONE[activeRun.status]}>{activeRun.status.replace(/_/g, " ")}</Badge>
                  {qualificationBlockedReason ? (
                    <p className="text-xs text-subtle">{qualificationBlockedReason}</p>
                  ) : (
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex gap-2">
                        {checklistIncomplete ? (
                          <span className="text-xs text-subtle" title="Complete every required checklist item before qualifying">
                            Qualify unavailable — required items incomplete
                          </span>
                        ) : (
                          <ActionForm action={qualifyLeadViaRunAction.bind(null, organizationSlug, leadId, activeRun.id)} hiddenFields={{ expectedRevision: activeRun.revision }}>
                            <SubmitButton>Qualify</SubmitButton>
                          </ActionForm>
                        )}
                        <ActionForm action={disqualifyLeadViaRunAction.bind(null, organizationSlug, leadId, activeRun.id)} hiddenFields={{ expectedRevision: activeRun.revision }}>
                          <SubmitButton variant="danger">Disqualify</SubmitButton>
                        </ActionForm>
                      </div>
                    </div>
                  )}
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
                            <ActionForm action={completeQualificationItemAction.bind(null, organizationSlug, leadId, item.id)} hiddenFields={{ status: "complete" }}>
                              <SubmitButton>Complete</SubmitButton>
                            </ActionForm>
                            <ActionForm action={completeQualificationItemAction.bind(null, organizationSlug, leadId, item.id)} hiddenFields={{ status: "skipped" }}>
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
                {Array.isArray(activeRun.missingInformation) && activeRun.missingInformation.length > 0 ? (
                  <p className="text-xs text-subtle">Missing: {activeRun.missingInformation.join(", ")}</p>
                ) : null}
              </Card>
            ) : null}
            <ul className="flex flex-col gap-2">
              {runs
                .filter((r) => r.id !== activeRun?.id)
                .map((run) => (
                  <Card as="li" key={run.id} padding="sm" className="flex items-center justify-between gap-3">
                    <span className="text-sm text-foreground">Run {run.id.slice(0, 8)}</span>
                    <Badge tone={RUN_STATUS_TONE[run.status]}>{run.status.replace(/_/g, " ")}</Badge>
                  </Card>
                ))}
            </ul>
          </div>
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
                <span className="ml-2 text-xs text-subtle">{a.occurredAt.toLocaleString()}</span>
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
