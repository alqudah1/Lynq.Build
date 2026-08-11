import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { getCompanyForUser } from "@/lib/crm/companies";
import { listRelationshipsForCompany } from "@/lib/crm/relationships";
import { listContactsByIds } from "@/lib/crm/contacts";
import { listActivitiesForUser } from "@/lib/crm/activities";
import { searchOpportunities } from "@/lib/crm/search";
import { listProjectLinksForCrmEntity } from "@/lib/crm/project-links";
import { listProjectsForUser } from "@/lib/projects/projects";
import { archiveCompanyAction, createActivityAction, createProjectLinkAction } from "@/lib/dashboard/actions/crm";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { CreateActivityForm } from "@/components/dashboard/crm/CreateActivityForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

export default async function CompanyDetailPage({ params }: { params: Promise<{ organizationSlug: string; companyId: string }> }) {
  const { organizationSlug, companyId } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/crm/companies/${companyId}`);

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

  let company;
  try {
    company = await getCompanyForUser(db, { organizationId, companyId, actorUserId: user.userId });
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const [relationships, activities, opportunities, projectLinks, projects] = await Promise.all([
    listRelationshipsForCompany(db, { organizationId, companyId, actorUserId: user.userId }),
    listActivitiesForUser(db, { organizationId, actorUserId: user.userId, companyId, limit: 50 }),
    searchOpportunities(db, { organizationId, actorUserId: user.userId, companyId }),
    listProjectLinksForCrmEntity(db, { organizationId, crmEntityType: "company", crmEntityId: companyId, actorUserId: user.userId }),
    listProjectsForUser(db, { organizationId, actorUserId: user.userId }),
  ]);

  const contactIds = relationships.map((r) => r.contactId);
  const contacts = await listContactsByIds(db, organizationId, contactIds);
  const contactNameById = new Map(contacts.map((c) => [c.id, c.displayName]));
  const redirectPath = `/app/${organizationSlug}/crm/companies/${companyId}`;
  const linkedProjectIds = new Set(projectLinks.map((link) => link.projectId));
  const availableProjects = projects.filter((project) => !linkedProjectIds.has(project.id));

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs
        items={[
          { label: "LYNQ", href: "/app" },
          { label: organizationName, href: `/app/${organizationSlug}` },
          { label: "CRM", href: `/app/${organizationSlug}/crm` },
          { label: "Companies", href: `/app/${organizationSlug}/crm/companies` },
          { label: company.name },
        ]}
      />

      <PageHeader
        title={company.name}
        description={`${company.domain ?? "No domain"} · ${company.industry ?? "No industry"} · ${company.lifecycleStage.replace(/_/g, " ")}`}
        actions={
          company.status === "active" ? (
            <ConfirmDialog
              triggerLabel="Archive company"
              title="Archive this company?"
              description="The company will be excluded from normal lists. This does not delete any activity history."
              confirmLabel="Archive"
              triggerVariant="danger"
              variant="danger"
              hiddenFields={{ expectedRevision: String(company.revision) }}
              formAction={archiveCompanyAction.bind(null, organizationSlug, companyId)}
            />
          ) : (
            <span className="text-xs uppercase tracking-[0.1em] text-subtle">Archived</span>
          )
        }
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Contacts</h2>
        {relationships.length === 0 ? <EmptyState title="No linked contacts." /> : (
          <ul className="flex flex-col gap-2">
            {relationships.map((r) => (
              <Card as="li" key={r.id} padding="sm" className="text-sm">
                <Link href={`/app/${organizationSlug}/crm/contacts/${r.contactId}`} className="lynq-transition text-foreground hover:text-accent-foreground">
                  {contactNameById.get(r.contactId) ?? r.contactId}
                </Link>
                <span className="ml-2 text-xs uppercase tracking-[0.1em] text-subtle">{r.relationshipType.replace(/_/g, " ")}</span>
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Opportunities</h2>
        {opportunities.results.length === 0 ? <EmptyState title="No opportunities for this company." /> : (
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
        {availableProjects.length > 0 ? (
          <form action={createProjectLinkAction.bind(null, organizationSlug)} className="flex flex-wrap items-end gap-3 rounded-md border border-border p-4">
            <input type="hidden" name="crmEntityType" value="company" />
            <input type="hidden" name="crmEntityId" value={companyId} />
            <input type="hidden" name="redirectPath" value={redirectPath} />
            <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs uppercase tracking-[0.08em] text-subtle">
              Link project
              <select name="projectId" defaultValue="" className="min-h-11 rounded-sm border border-border bg-background px-3 text-sm normal-case tracking-normal text-foreground">
                <option value="" disabled>Select a project</option>
                {availableProjects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="lynq-transition min-h-11 rounded-sm border border-border px-4 text-xs font-medium uppercase tracking-[0.08em] text-foreground hover:border-border-strong">
              Link project
            </button>
          </form>
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
        <CreateActivityForm target={{ companyId }} redirectPath={redirectPath} action={createActivityAction.bind(null, organizationSlug)} />
      </section>
    </div>
  );
}
