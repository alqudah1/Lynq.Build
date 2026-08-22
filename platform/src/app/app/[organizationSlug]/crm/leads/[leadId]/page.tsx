import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { getLeadForUser } from "@/lib/crm/leads";
import { resolveContactById } from "@/lib/crm/contacts";
import { resolveCompanyById } from "@/lib/crm/companies";
import { listActivitiesForUser } from "@/lib/crm/activities";
import { listNotesForUser } from "@/lib/crm/notes";
import { listPipelinesForUser } from "@/lib/crm/pipelines";
import { listStagesForPipeline } from "@/lib/crm/stages";
import { qualifyLeadAction, disqualifyLeadAction, convertLeadAction, createActivityAction, createNoteAction, archiveNoteAction } from "@/lib/dashboard/actions/crm";
import { listOrganizationMembers } from "@/lib/organizations/memberships";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { LeadQualificationControls } from "@/components/dashboard/crm/LeadQualificationControls";
import { CreateActivityForm } from "@/components/dashboard/crm/CreateActivityForm";
import { CreateNoteForm } from "@/components/dashboard/crm/CreateNoteForm";
import { NoteCard } from "@/components/dashboard/crm/NoteCard";
import { ContactActions } from "@/components/dashboard/crm/ContactActions";
import { resolveCompanyOutreachContext } from "@/lib/lead-gen/company-facts";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

const LEAD_STATUS_TONE: Record<string, BadgeTone> = {
  new: "neutral",
  contacted: "info",
  engaged: "info",
  qualified: "accent",
  disqualified: "danger",
  converted: "success",
};

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: Promise<{ organizationSlug: string; leadId: string }> }) {
  const { organizationSlug, leadId } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/crm/leads/${leadId}`);

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

  let lead;
  try {
    lead = await getLeadForUser(db, { organizationId, leadId, actorUserId: user.userId });
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const [contact, company, activities, notes, pipelines, members] = await Promise.all([
    lead.contactId ? resolveContactById(db, organizationId, lead.contactId) : null,
    lead.companyId ? resolveCompanyById(db, organizationId, lead.companyId) : null,
    listActivitiesForUser(db, { organizationId, actorUserId: user.userId, leadId, limit: 50 }),
    listNotesForUser(db, { organizationId, actorUserId: user.userId, leadId, limit: 50 }),
    listPipelinesForUser(db, { organizationId, actorUserId: user.userId }),
    listOrganizationMembers(db, organizationId, user.userId),
  ]);

  const pipelinesWithStages = await Promise.all(
    pipelines.map(async (p) => ({ id: p.id, name: p.name, stages: (await listStagesForPipeline(db, { organizationId, pipelineId: p.id, actorUserId: user.userId })).filter((s) => !s.isClosed).map((s) => ({ id: s.id, name: s.name })) }))
  );

  const memberNameById = new Map(members.map((m) => [m.userId, m.name ?? m.email]));
  const contactPhone = contact?.primaryPhone ?? company?.phone;
  // Same single derivation the leads table uses — market, price, demo URL
  // and demo eligibility never diverge between the two views.
  const outreachContext = company ? resolveCompanyOutreachContext(company, contact) : null;
  const redirectPath = `/app/${organizationSlug}/crm/leads/${leadId}`;
  const target = { leadId };
  const canManage = true; // service layer re-derives and enforces the real authority on every action; this only controls whether the controls render

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs
        items={[
          { label: "LYNQ", href: "/app" },
          { label: organizationName, href: `/app/${organizationSlug}` },
          { label: "CRM", href: `/app/${organizationSlug}/crm` },
          { label: "Leads", href: `/app/${organizationSlug}/crm/leads` },
          { label: lead.id.slice(0, 8) },
        ]}
      />

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-3xl italic font-light text-foreground">Lead {lead.id.slice(0, 8)}</h1>
          <Badge tone={LEAD_STATUS_TONE[lead.status] ?? "neutral"}>{lead.status}</Badge>
        </div>
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
        {lead.qualificationNotes ? <p className="mt-2 text-sm text-foreground">{lead.qualificationNotes}</p> : null}
        {contact || company ? (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-sm text-muted">
              {contact?.primaryEmail ?? "No published email"}
              {" · "}
              {contact?.primaryPhone ?? company?.phone ?? "No phone number"}
            </p>
            <ContactActions
              email={contact?.primaryEmail}
              phone={contactPhone}
              businessName={company?.name ?? contact?.displayName ?? `Lead ${lead.id.slice(0, 8)}`}
              market={outreachContext?.market ?? null}
              demoUrl={outreachContext?.demoUrl ?? null}
              outreach={outreachContext?.outreach ?? null}
              eligibility={outreachContext?.eligibility ?? { eligible: false, reason: "never_reviewed", detail: "No prospect company is linked to this lead.", score: null }}
            />
          </div>
        ) : null}
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Qualification</h2>
        <LeadQualificationControls
          status={lead.status}
          expectedRevision={lead.revision}
          canManage={canManage}
          pipelines={pipelinesWithStages}
          qualifyAction={qualifyLeadAction.bind(null, organizationSlug, leadId)}
          disqualifyAction={disqualifyLeadAction.bind(null, organizationSlug, leadId)}
          convertAction={convertLeadAction.bind(null, organizationSlug, leadId)}
        />
        {lead.convertedOpportunityId ? (
          <p className="text-sm text-muted">
            Converted to{" "}
            <Link href={`/app/${organizationSlug}/crm/opportunities/${lead.convertedOpportunityId}`} className="lynq-transition text-accent-foreground hover:opacity-80">
              this opportunity
            </Link>
            .
          </p>
        ) : null}
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
