import Link from "next/link";
import type { CrmLead } from "@/lib/crm/leads";
import { Tr, Td } from "@/components/ui/Table";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

const STATUS_TONE: Record<string, BadgeTone> = {
  new: "neutral",
  contacted: "info",
  engaged: "info",
  qualified: "accent",
  disqualified: "danger",
  converted: "success",
};

export function LeadRow({ organizationSlug, lead, ownerName }: { organizationSlug: string; lead: CrmLead; ownerName: string }) {
  return (
    <Tr>
      <Td>
        <Link href={`/app/${organizationSlug}/crm/leads/${lead.id}`} className="lynq-transition font-medium text-foreground hover:text-accent-foreground">
          {lead.id.slice(0, 8)}
        </Link>
      </Td>
      <Td>
        <Badge tone={STATUS_TONE[lead.status] ?? "neutral"}>{lead.status}</Badge>
      </Td>
      <Td className="hidden text-muted sm:table-cell">{lead.score ?? "—"}</Td>
      <Td className="hidden text-muted md:table-cell">{lead.estimatedValueAmount ? `${lead.estimatedValueAmount} ${lead.estimatedValueCurrency ?? ""}` : "—"}</Td>
      <Td className="hidden text-muted lg:table-cell">{ownerName}</Td>
    </Tr>
  );
}
