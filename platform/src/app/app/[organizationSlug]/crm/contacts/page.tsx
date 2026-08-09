import { inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users } from "@/db/schema";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listContactsForUser } from "@/lib/crm/contacts";
import { createContactAction } from "@/lib/dashboard/actions/crm";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { CreateContactForm } from "@/components/dashboard/crm/CreateContactForm";
import { ContactRow } from "@/components/dashboard/crm/ContactRow";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, THead, TBody, Tr, Th } from "@/components/ui/Table";

export const dynamic = "force-dynamic";

export default async function ContactsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/crm/contacts`);

  let organizationName: string;
  let contacts: Awaited<ReturnType<typeof listContactsForUser>>;
  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationName = organization.name;
    contacts = await listContactsForUser(db, { organizationId: organization.id, actorUserId: user.userId, limit: 200 });
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const ownerIds = [...new Set(contacts.map((c) => c.ownerUserId).filter((id): id is string => Boolean(id)))];
  const owners = ownerIds.length > 0 ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, ownerIds)) : [];
  const ownerNameById = new Map(owners.map((o) => [o.id, o.name ?? o.email]));

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "CRM", href: `/app/${organizationSlug}/crm` }, { label: "Contacts" }]} />
      <PageHeader title="Contacts" />

      <CreateContactForm action={createContactAction.bind(null, organizationSlug)} />

      {contacts.length === 0 ? (
        <EmptyState title="No contacts yet." description="Create the first one above." />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Name</Th>
              <Th className="hidden sm:table-cell">Email</Th>
              <Th className="hidden md:table-cell">Phone</Th>
              <Th>Lifecycle</Th>
              <Th className="hidden lg:table-cell">Owner</Th>
            </Tr>
          </THead>
          <TBody>
            {contacts.map((contact) => (
              <ContactRow key={contact.id} organizationSlug={organizationSlug} contact={contact} ownerName={contact.ownerUserId ? (ownerNameById.get(contact.ownerUserId) ?? "—") : "—"} />
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
