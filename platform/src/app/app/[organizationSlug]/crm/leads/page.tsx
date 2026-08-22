import { inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users } from "@/db/schema";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listLeadsForUser } from "@/lib/crm/leads";
import { listContactsByIds, listContactsForUser } from "@/lib/crm/contacts";
import { listCompaniesByIds, listCompaniesForUser } from "@/lib/crm/companies";
import { createLeadAction } from "@/lib/dashboard/actions/crm";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { CreateLeadForm } from "@/components/dashboard/crm/CreateLeadForm";
import { LeadRow } from "@/components/dashboard/crm/LeadRow";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, THead, TBody, Tr, Th } from "@/components/ui/Table";

export const dynamic = "force-dynamic";

export default async function LeadsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/crm/leads`);

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

  const [leads, contacts, companies] = await Promise.all([
    listLeadsForUser(db, { organizationId, actorUserId: user.userId, limit: 1000 }),
    listContactsForUser(db, { organizationId, actorUserId: user.userId, limit: 200 }),
    listCompaniesForUser(db, { organizationId, actorUserId: user.userId, limit: 200 }),
  ]);

  const leadContactIds = [...new Set(leads.map((lead) => lead.contactId).filter((id): id is string => Boolean(id)))];
  const leadCompanyIds = [...new Set(leads.map((lead) => lead.companyId).filter((id): id is string => Boolean(id)))];
  const [leadContacts, leadCompanies] = await Promise.all([
    listContactsByIds(db, organizationId, leadContactIds),
    listCompaniesByIds(db, organizationId, leadCompanyIds),
  ]);
  const contactById = new Map(leadContacts.map((contact) => [contact.id, contact]));
  const companyById = new Map(leadCompanies.map((company) => [company.id, company]));
  const countryCodeForCompany = (companyId: string | null): string | null => {
    if (!companyId) return null;
    const countryCode = companyById.get(companyId)?.address?.countryCode;
    return typeof countryCode === "string" ? countryCode : null;
  };
  const countryCodeForLead = (companyId: string | null, phone?: string | null): string | null => {
    const companyCountryCode = countryCodeForCompany(companyId);
    if (companyCountryCode === "CA" || companyCountryCode === "JO") return companyCountryCode;
    const digits = phone?.replace(/\D/g, "") ?? "";
    if (digits.startsWith("962")) return "JO";
    if (digits.startsWith("1")) return "CA";
    return null;
  };

  const ownerIds = [...new Set(leads.map((l) => l.ownerUserId).filter((id): id is string => Boolean(id)))];
  const owners = ownerIds.length > 0 ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, ownerIds)) : [];
  const ownerNameById = new Map(owners.map((o) => [o.id, o.name ?? o.email]));

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "CRM", href: `/app/${organizationSlug}/crm` }, { label: "Leads" }]} />
      <PageHeader
        title="Leads"
        actions={
          <Link
            href={`/app/${organizationSlug}/crm/leads/import`}
            className="lynq-transition flex min-h-11 items-center rounded-sm bg-foreground px-5 text-xs font-medium uppercase tracking-[0.08em] text-background hover:opacity-90"
          >
            Import prospects
          </Link>
        }
      />

      <CreateLeadForm
        contacts={contacts.map((c) => ({ id: c.id, name: c.displayName }))}
        companies={companies.map((c) => ({ id: c.id, name: c.name }))}
        action={createLeadAction.bind(null, organizationSlug)}
      />

      {leads.length === 0 ? (
        <EmptyState title="No leads yet." description="Create the first one above." />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Business</Th>
              <Th>Status</Th>
              <Th className="hidden sm:table-cell">Score</Th>
              <Th className="hidden md:table-cell">Contact</Th>
              <Th className="hidden lg:table-cell">Owner</Th>
              <Th>Actions</Th>
            </Tr>
          </THead>
          <TBody>
            {leads.map((lead) => (
              <LeadRow
                key={lead.id}
                organizationSlug={organizationSlug}
                lead={lead}
                ownerName={lead.ownerUserId ? (ownerNameById.get(lead.ownerUserId) ?? "—") : "—"}
                companyName={lead.companyId ? (companyById.get(lead.companyId)?.name ?? `Lead ${lead.id.slice(0, 8)}`) : `Lead ${lead.id.slice(0, 8)}`}
                countryCode={countryCodeForLead(lead.companyId, lead.contactId ? contactById.get(lead.contactId)?.primaryPhone : null)}
                contact={lead.contactId && contactById.has(lead.contactId) ? {
                  name: contactById.get(lead.contactId)!.displayName,
                  email: contactById.get(lead.contactId)!.primaryEmail,
                  phone: contactById.get(lead.contactId)!.primaryPhone,
                } : undefined}
              />
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
