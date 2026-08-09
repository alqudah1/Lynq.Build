import Link from "next/link";
import type { CrmContact } from "@/lib/crm/contacts";
import { Tr, Td } from "@/components/ui/Table";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

const LIFECYCLE_TONE: Record<string, BadgeTone> = {
  subscriber: "neutral",
  lead: "info",
  qualified_lead: "info",
  opportunity: "accent",
  customer: "success",
  former_customer: "neutral",
  partner: "accent",
  other: "neutral",
};

export function ContactRow({ organizationSlug, contact, ownerName }: { organizationSlug: string; contact: CrmContact; ownerName: string }) {
  return (
    <Tr>
      <Td>
        <Link href={`/app/${organizationSlug}/crm/contacts/${contact.id}`} className="lynq-transition font-medium text-foreground hover:text-accent-foreground">
          {contact.displayName}
        </Link>
      </Td>
      <Td className="hidden text-muted sm:table-cell">{contact.primaryEmail ?? "—"}</Td>
      <Td className="hidden text-muted md:table-cell">{contact.primaryPhone ?? "—"}</Td>
      <Td>
        <Badge tone={LIFECYCLE_TONE[contact.lifecycleStage] ?? "neutral"}>{contact.lifecycleStage.replace(/_/g, " ")}</Badge>
      </Td>
      <Td className="hidden text-muted lg:table-cell">{ownerName}</Td>
    </Tr>
  );
}
