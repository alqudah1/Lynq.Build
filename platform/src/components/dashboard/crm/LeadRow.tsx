import Link from "next/link";
import type { CrmLead } from "@/lib/crm/leads";
import { Tr, Td } from "@/components/ui/Table";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { ContactActions } from "@/components/dashboard/crm/ContactActions";

const STATUS_TONE: Record<string, BadgeTone> = {
  new: "neutral",
  contacted: "info",
  engaged: "info",
  qualified: "accent",
  disqualified: "danger",
  converted: "success",
};

export function LeadRow({ organizationSlug, lead, ownerName, companyName, contact, countryCode, demoSlug }: { organizationSlug: string; lead: CrmLead; ownerName: string; companyName: string; contact?: { name: string; email: string | null; phone: string | null }; countryCode?: string | null; demoSlug?: string | null }) {
  return (
    <Tr className="[content-visibility:auto] [contain-intrinsic-size:56px]">
      <Td>
        <Link href={`/app/${organizationSlug}/crm/leads/${lead.id}`} className="lynq-transition font-medium text-foreground hover:text-accent-foreground">
          {companyName}
        </Link>
      </Td>
      <Td>
        <Badge tone={STATUS_TONE[lead.status] ?? "neutral"}>{lead.status}</Badge>
      </Td>
      <Td className="hidden text-muted sm:table-cell">{lead.score ?? "—"}</Td>
      <Td className="hidden text-muted md:table-cell">{contact ? <span title={contact.email ?? contact.phone ?? undefined}>{contact.name}</span> : "—"}</Td>
      <Td className="hidden text-muted lg:table-cell">{ownerName}</Td>
      <Td><ContactActions email={contact?.email} phone={contact?.phone} businessName={companyName} countryCode={countryCode} demoSlug={demoSlug} /></Td>
    </Tr>
  );
}
