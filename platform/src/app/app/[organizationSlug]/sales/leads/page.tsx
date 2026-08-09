import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listOrganizationMembers } from "@/lib/organizations/memberships";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { listLeadsInQueue, LEAD_QUEUES, type LeadQueue } from "@/lib/sales-os/lead-queues";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, THead, TBody, Tr, Th, Td } from "@/components/ui/Table";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

const QUEUE_LABEL: Record<LeadQueue, string> = {
  unassigned: "Unassigned",
  new: "New",
  contacted: "Contacted",
  engaged: "Engaged",
  qualification_due: "Qualification due",
  stale: "Stale",
  qualified: "Qualified",
  disqualified: "Disqualified",
};

const STATUS_TONE: Record<string, BadgeTone> = {
  new: "neutral",
  contacted: "info",
  engaged: "info",
  qualified: "accent",
  disqualified: "danger",
  converted: "success",
};

export default async function SalesLeadsPage({ params, searchParams }: { params: Promise<{ organizationSlug: string }>; searchParams: Promise<{ queue?: string }> }) {
  const { organizationSlug } = await params;
  const { queue: rawQueue } = await searchParams;
  const queue: LeadQueue = LEAD_QUEUES.includes(rawQueue as LeadQueue) ? (rawQueue as LeadQueue) : "unassigned";

  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/sales/leads`);

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

  const [leads, members] = await Promise.all([listLeadsInQueue(db, { organizationId, queue, actorUserId: user.userId, limit: 100 }), listOrganizationMembers(db, organizationId, user.userId)]);
  const memberNameById = new Map(members.map((m) => [m.userId, m.name ?? m.email]));

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Sales", href: `/app/${organizationSlug}/sales` }, { label: "Leads" }]} />
      <PageHeader title="Leads" description="Operational queues derived from CRM lead state — never a duplicate of the CRM lead list." />

      <nav aria-label="Lead queues" className="flex flex-wrap gap-2 text-sm">
        {LEAD_QUEUES.map((q) => (
          <Link
            key={q}
            href={`/app/${organizationSlug}/sales/leads?queue=${q}`}
            className={`lynq-transition rounded-sm border px-3 py-1.5 ${q === queue ? "border-transparent bg-foreground text-background" : "border-border text-foreground hover:border-border-strong"}`}
          >
            {QUEUE_LABEL[q]}
          </Link>
        ))}
      </nav>

      {leads.length === 0 ? (
        <EmptyState title={`No leads in "${QUEUE_LABEL[queue]}."`} />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Lead</Th>
              <Th>Status</Th>
              <Th className="hidden sm:table-cell">Score</Th>
              <Th className="hidden md:table-cell">Estimated value</Th>
              <Th className="hidden lg:table-cell">Owner</Th>
            </Tr>
          </THead>
          <TBody>
            {leads.map((lead) => (
              <Tr key={lead.id}>
                <Td>
                  <Link href={`/app/${organizationSlug}/sales/leads/${lead.id}`} className="lynq-transition font-medium text-foreground hover:text-accent-foreground">
                    {lead.id.slice(0, 8)}
                  </Link>
                </Td>
                <Td>
                  <Badge tone={STATUS_TONE[lead.status] ?? "neutral"}>{lead.status}</Badge>
                </Td>
                <Td className="hidden text-muted sm:table-cell">{lead.score ?? "—"}</Td>
                <Td className="hidden text-muted md:table-cell">{lead.estimatedValueAmount ? `${lead.estimatedValueAmount} ${lead.estimatedValueCurrency ?? ""}` : "—"}</Td>
                <Td className="hidden text-muted lg:table-cell">{lead.ownerUserId ? (memberNameById.get(lead.ownerUserId) ?? "—") : "Unassigned"}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
