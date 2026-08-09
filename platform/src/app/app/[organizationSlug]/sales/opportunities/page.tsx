import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listOrganizationMembers } from "@/lib/organizations/memberships";
import { listOpportunitiesForUser } from "@/lib/crm/opportunities";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { computeOpportunityHealthForMany } from "@/lib/sales-os/health";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, THead, TBody, Tr, Th, Td } from "@/components/ui/Table";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, BadgeTone> = { open: "info", won: "success", lost: "danger" };
const HEALTH_TONE: Record<string, BadgeTone> = { healthy: "success", attention: "warning", at_risk: "danger" };

export default async function SalesOpportunitiesPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/sales/opportunities`);

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

  const [opportunities, members] = await Promise.all([listOpportunitiesForUser(db, { organizationId, actorUserId: user.userId, status: "open", limit: 100 }), listOrganizationMembers(db, organizationId, user.userId)]);
  const memberNameById = new Map(members.map((m) => [m.userId, m.name ?? m.email]));
  const healthByOpportunity = await computeOpportunityHealthForMany(db, { organizationId, opportunities });

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Sales", href: `/app/${organizationSlug}/sales` }, { label: "Opportunities" }]} />
      <PageHeader title="Opportunities" description="Open CRM opportunities with Sales OS's deterministic health signal." />

      {opportunities.length === 0 ? (
        <EmptyState title="No open opportunities." />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Name</Th>
              <Th>Status</Th>
              <Th>Health</Th>
              <Th className="hidden sm:table-cell">Amount</Th>
              <Th className="hidden lg:table-cell">Owner</Th>
            </Tr>
          </THead>
          <TBody>
            {opportunities.map((opp) => {
              const health = healthByOpportunity.get(opp.id);
              return (
                <Tr key={opp.id}>
                  <Td>
                    <Link href={`/app/${organizationSlug}/sales/opportunities/${opp.id}`} className="lynq-transition font-medium text-foreground hover:text-accent-foreground">
                      {opp.name}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[opp.status] ?? "neutral"}>{opp.status}</Badge>
                  </Td>
                  <Td>{health ? <Badge tone={HEALTH_TONE[health.status]}>{health.status.replace(/_/g, " ")}</Badge> : "—"}</Td>
                  <Td className="hidden text-muted sm:table-cell">{opp.amount ? `${opp.amount} ${opp.currency ?? ""}` : "—"}</Td>
                  <Td className="hidden text-muted lg:table-cell">{opp.ownerUserId ? (memberNameById.get(opp.ownerUserId) ?? "—") : "Unassigned"}</Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </div>
  );
}
