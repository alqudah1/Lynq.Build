import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listContactsForUser } from "@/lib/crm/contacts";
import { listCompaniesForUser } from "@/lib/crm/companies";
import { listLeadsForUser } from "@/lib/crm/leads";
import { listOpportunitiesForUser } from "@/lib/crm/opportunities";
import { listFollowUpsForUser } from "@/lib/crm/follow-ups";
import { listPipelinesForUser } from "@/lib/crm/pipelines";
import { listStagesForPipeline } from "@/lib/crm/stages";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

/** CRM overview — real counts only, no fake metrics. */
export default async function CrmOverviewPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/crm`);

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

  const [contacts, companies, openLeads, openOpportunities, dueFollowUps, pipelines] = await Promise.all([
    listContactsForUser(db, { organizationId, actorUserId: user.userId, limit: 200 }),
    listCompaniesForUser(db, { organizationId, actorUserId: user.userId, limit: 200 }),
    listLeadsForUser(db, { organizationId, actorUserId: user.userId, limit: 200 }),
    listOpportunitiesForUser(db, { organizationId, actorUserId: user.userId, status: "open", limit: 200 }),
    listFollowUpsForUser(db, { organizationId, actorUserId: user.userId, status: "open", limit: 200 }),
    listPipelinesForUser(db, { organizationId, actorUserId: user.userId }),
  ]);

  const openLeadCount = openLeads.filter((l) => !["converted", "disqualified"].includes(l.status)).length;

  const pipelineSummaries = await Promise.all(
    pipelines.map(async (pipeline) => {
      const stages = await listStagesForPipeline(db, { organizationId, pipelineId: pipeline.id, actorUserId: user.userId });
      const opportunitiesInPipeline = openOpportunities.filter((o) => o.pipelineId === pipeline.id);
      return { pipeline, stageCount: stages.length, opportunityCount: opportunitiesInPipeline.length };
    })
  );

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "CRM" }]} />
      <PageHeader title="CRM" description="Contacts, companies, leads, and opportunities across your organization." />

      <section aria-label="Overview" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard href={`/app/${organizationSlug}/crm/contacts`} label="Contacts" value={contacts.length} />
        <SummaryCard href={`/app/${organizationSlug}/crm/companies`} label="Companies" value={companies.length} />
        <SummaryCard href={`/app/${organizationSlug}/crm/leads`} label="Open leads" value={openLeadCount} />
        <SummaryCard href={`/app/${organizationSlug}/crm/opportunities`} label="Open opportunities" value={openOpportunities.length} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Follow-ups due</h2>
        {dueFollowUps.length === 0 ? (
          <EmptyState title="No open follow-ups." />
        ) : (
          <ul className="flex flex-col gap-2">
            {dueFollowUps.slice(0, 10).map((f) => (
              <Card as="li" key={f.id} padding="sm" className="text-sm text-foreground">
                {f.title} {f.dueAt ? <span className="text-muted">— due {f.dueAt.toLocaleDateString()}</span> : null}
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Pipeline summary</h2>
        {pipelineSummaries.length === 0 ? (
          <EmptyState
            title="No pipelines yet."
            action={
              <Link href={`/app/${organizationSlug}/crm/pipelines`} className="lynq-transition text-sm text-accent-foreground hover:opacity-80">
                Create one →
              </Link>
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {pipelineSummaries.map(({ pipeline, stageCount, opportunityCount }) => (
              <li key={pipeline.id}>
                <Card as={Link} href={`/app/${organizationSlug}/crm/pipelines`} interactive padding="sm" className="flex items-center justify-between gap-4">
                  <span className="text-sm text-foreground">{pipeline.name}</span>
                  <span className="text-sm text-subtle">
                    {stageCount} stages · {opportunityCount} open opportunities
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SummaryCard({ href, label, value }: { href: string; label: string; value: number }) {
  return (
    <Card as={Link} href={href} interactive className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-[0.15em] text-subtle">{label}</span>
      <span className="font-serif text-3xl italic font-light text-foreground">{value}</span>
    </Card>
  );
}
