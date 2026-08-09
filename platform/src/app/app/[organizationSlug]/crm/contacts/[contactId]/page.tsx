import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { getContactForUser } from "@/lib/crm/contacts";
import { listRelationshipsForContact } from "@/lib/crm/relationships";
import { listCompaniesForUser, listCompaniesByIds } from "@/lib/crm/companies";
import { listActivitiesForUser } from "@/lib/crm/activities";
import { listNotesForUser } from "@/lib/crm/notes";
import { listFollowUpsForUser } from "@/lib/crm/follow-ups";
import { searchLeads, searchOpportunities } from "@/lib/crm/search";
import { listProjectLinksForCrmEntity } from "@/lib/crm/project-links";
import {
  createRelationshipAction,
  archiveContactAction,
  createActivityAction,
  createNoteAction,
  archiveNoteAction,
  createFollowUpAction,
  completeFollowUpAction,
  cancelFollowUpAction,
} from "@/lib/dashboard/actions/crm";
import { listOrganizationMembers } from "@/lib/organizations/memberships";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { CreateRelationshipForm } from "@/components/dashboard/crm/CreateRelationshipForm";
import { CreateActivityForm } from "@/components/dashboard/crm/CreateActivityForm";
import { CreateNoteForm } from "@/components/dashboard/crm/CreateNoteForm";
import { NoteCard } from "@/components/dashboard/crm/NoteCard";
import { CreateFollowUpForm } from "@/components/dashboard/crm/CreateFollowUpForm";
import { FollowUpRow } from "@/components/dashboard/crm/FollowUpRow";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

export default async function ContactDetailPage({ params }: { params: Promise<{ organizationSlug: string; contactId: string }> }) {
  const { organizationSlug, contactId } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/crm/contacts/${contactId}`);

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

  let contact;
  try {
    contact = await getContactForUser(db, { organizationId, contactId, actorUserId: user.userId });
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const [relationships, allCompanies, activities, notes, followUps, leads, opportunities, projectLinks, members] = await Promise.all([
    listRelationshipsForContact(db, { organizationId, contactId, actorUserId: user.userId }),
    listCompaniesForUser(db, { organizationId, actorUserId: user.userId, limit: 200 }),
    listActivitiesForUser(db, { organizationId, actorUserId: user.userId, contactId, limit: 50 }),
    listNotesForUser(db, { organizationId, actorUserId: user.userId, contactId, limit: 50 }),
    listFollowUpsForUser(db, { organizationId, actorUserId: user.userId, contactId, limit: 50 }),
    searchLeads(db, { organizationId, actorUserId: user.userId, contactId }),
    searchOpportunities(db, { organizationId, actorUserId: user.userId, contactId }),
    listProjectLinksForCrmEntity(db, { organizationId, crmEntityType: "contact", crmEntityId: contactId, actorUserId: user.userId }),
    listOrganizationMembers(db, organizationId, user.userId),
  ]);

  const linkedCompanyIds = relationships.map((r) => r.companyId);
  const linkedCompanies = await listCompaniesByIds(db, organizationId, linkedCompanyIds);
  const companyNameById = new Map(linkedCompanies.map((c) => [c.id, c.name]));
  const memberNameById = new Map(members.map((m) => [m.userId, m.name ?? m.email]));
  const redirectPath = `/app/${organizationSlug}/crm/contacts/${contactId}`;
  const target = { contactId };

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs
        items={[
          { label: "LYNQ", href: "/app" },
          { label: organizationName, href: `/app/${organizationSlug}` },
          { label: "CRM", href: `/app/${organizationSlug}/crm` },
          { label: "Contacts", href: `/app/${organizationSlug}/crm/contacts` },
          { label: contact.displayName },
        ]}
      />

      <PageHeader
        title={contact.displayName}
        description={`${contact.primaryEmail ?? "No email"} · ${contact.primaryPhone ?? "No phone"} · ${contact.lifecycleStage.replace(/_/g, " ")}`}
        actions={
          contact.status === "active" ? (
            <ConfirmDialog
              triggerLabel="Archive contact"
              title="Archive this contact?"
              description="The contact will be excluded from normal lists. This does not delete any activity history."
              confirmLabel="Archive"
              triggerVariant="danger"
              variant="danger"
              hiddenFields={{ expectedRevision: String(contact.revision) }}
              formAction={archiveContactAction.bind(null, organizationSlug, contactId)}
            />
          ) : (
            <span className="text-xs uppercase tracking-[0.1em] text-subtle">Archived</span>
          )
        }
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Companies</h2>
        {relationships.length === 0 ? <EmptyState title="Not linked to any company yet." /> : (
          <ul className="flex flex-col gap-2">
            {relationships.map((r) => (
              <Card as="li" key={r.id} padding="sm" className="text-sm">
                <Link href={`/app/${organizationSlug}/crm/companies/${r.companyId}`} className="lynq-transition text-foreground hover:text-accent-foreground">
                  {companyNameById.get(r.companyId) ?? r.companyId}
                </Link>
                <span className="ml-2 text-xs uppercase tracking-[0.1em] text-subtle">
                  {r.relationshipType.replace(/_/g, " ")}
                  {r.isPrimary ? " · primary" : ""}
                  {r.status === "ended" ? " · ended" : ""}
                </span>
              </Card>
            ))}
          </ul>
        )}
        <CreateRelationshipForm contactId={contactId} companies={allCompanies.map((c) => ({ id: c.id, name: c.name }))} action={createRelationshipAction.bind(null, organizationSlug)} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Leads</h2>
        {leads.results.length === 0 ? <EmptyState title="No leads for this contact." /> : (
          <ul className="flex flex-col gap-2">
            {leads.results.map((l) => (
              <Card as="li" key={l.id} padding="sm" className="text-sm">
                <Link href={`/app/${organizationSlug}/crm/leads/${l.id}`} className="lynq-transition capitalize text-foreground hover:text-accent-foreground">
                  Lead — {l.status}
                </Link>
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Opportunities</h2>
        {opportunities.results.length === 0 ? <EmptyState title="No opportunities for this contact." /> : (
          <ul className="flex flex-col gap-2">
            {opportunities.results.map((o) => (
              <Card as="li" key={o.id} padding="sm" className="text-sm">
                <Link href={`/app/${organizationSlug}/crm/opportunities/${o.id}`} className="lynq-transition text-foreground hover:text-accent-foreground">
                  {o.name}
                </Link>
                <span className="ml-2 text-xs uppercase tracking-[0.1em] text-subtle capitalize">{o.status}</span>
              </Card>
            ))}
          </ul>
        )}
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
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Activities</h2>
        {activities.length === 0 ? <EmptyState title="No activity recorded yet." /> : (
          <ul className="flex flex-col gap-2">
            {activities.map((a) => (
              <Card as="li" key={a.id} padding="sm" className="text-sm text-foreground">
                <span className="capitalize">{a.activityType.replace(/_/g, " ")}</span> — {a.subject ?? a.summary ?? "No details"}
                <span className="ml-2 text-xs text-subtle">{a.occurredAt.toLocaleString()}</span>
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

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Follow-ups</h2>
        {followUps.length === 0 ? <EmptyState title="No follow-ups yet." /> : (
          <ul className="flex flex-col gap-2">
            {followUps.map((f) => (
              <FollowUpRow
                key={f.id}
                followUp={f}
                assigneeName={memberNameById.get(f.assignedUserId) ?? "—"}
                redirectPath={redirectPath}
                completeAction={completeFollowUpAction.bind(null, organizationSlug, f.id)}
                cancelAction={cancelFollowUpAction.bind(null, organizationSlug, f.id)}
              />
            ))}
          </ul>
        )}
        <CreateFollowUpForm target={target} members={members.map((m) => ({ id: m.userId, name: m.name ?? m.email }))} redirectPath={redirectPath} action={createFollowUpAction.bind(null, organizationSlug)} />
      </section>
    </div>
  );
}
