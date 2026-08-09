import { inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users } from "@/db/schema";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listOpportunitiesForUser } from "@/lib/crm/opportunities";
import { listPipelinesForUser } from "@/lib/crm/pipelines";
import { listStagesForPipeline } from "@/lib/crm/stages";
import { listContactsForUser } from "@/lib/crm/contacts";
import { listCompaniesForUser } from "@/lib/crm/companies";
import { createOpportunityAction } from "@/lib/dashboard/actions/crm";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { CreateOpportunityForm } from "@/components/dashboard/crm/CreateOpportunityForm";
import { OpportunityRow } from "@/components/dashboard/crm/OpportunityRow";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, THead, TBody, Tr, Th } from "@/components/ui/Table";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/crm/opportunities`);

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

  const [opportunities, pipelines, contacts, companies] = await Promise.all([
    listOpportunitiesForUser(db, { organizationId, actorUserId: user.userId, limit: 200 }),
    listPipelinesForUser(db, { organizationId, actorUserId: user.userId }),
    listContactsForUser(db, { organizationId, actorUserId: user.userId, limit: 200 }),
    listCompaniesForUser(db, { organizationId, actorUserId: user.userId, limit: 200 }),
  ]);

  const pipelinesWithStages = await Promise.all(
    pipelines.map(async (p) => ({ id: p.id, name: p.name, stages: (await listStagesForPipeline(db, { organizationId, pipelineId: p.id, actorUserId: user.userId })).map((s) => ({ id: s.id, name: s.name, isClosed: s.isClosed })) }))
  );
  const stageNameById = new Map(pipelinesWithStages.flatMap((p) => p.stages.map((s) => [s.id, s.name] as const)));

  const ownerIds = [...new Set(opportunities.map((o) => o.ownerUserId).filter((id): id is string => Boolean(id)))];
  const owners = ownerIds.length > 0 ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, ownerIds)) : [];
  const ownerNameById = new Map(owners.map((o) => [o.id, o.name ?? o.email]));

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "CRM", href: `/app/${organizationSlug}/crm` }, { label: "Opportunities" }]} />
      <PageHeader title="Opportunities" />

      <CreateOpportunityForm
        pipelines={pipelinesWithStages}
        contacts={contacts.map((c) => ({ id: c.id, name: c.displayName }))}
        companies={companies.map((c) => ({ id: c.id, name: c.name }))}
        action={createOpportunityAction.bind(null, organizationSlug)}
      />

      {opportunities.length === 0 ? (
        <EmptyState title="No opportunities yet." description="Create the first one above." />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Name</Th>
              <Th className="hidden sm:table-cell">Stage</Th>
              <Th>Status</Th>
              <Th className="hidden md:table-cell">Amount</Th>
              <Th className="hidden lg:table-cell">Owner</Th>
            </Tr>
          </THead>
          <TBody>
            {opportunities.map((opportunity) => (
              <OpportunityRow
                key={opportunity.id}
                organizationSlug={organizationSlug}
                opportunity={opportunity}
                stageName={stageNameById.get(opportunity.stageId) ?? "—"}
                ownerName={opportunity.ownerUserId ? (ownerNameById.get(opportunity.ownerUserId) ?? "—") : "—"}
              />
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
