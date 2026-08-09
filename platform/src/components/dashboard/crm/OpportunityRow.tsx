import Link from "next/link";
import type { CrmOpportunity } from "@/lib/crm/opportunities";
import { Tr, Td } from "@/components/ui/Table";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

const STATUS_TONE: Record<string, BadgeTone> = {
  open: "info",
  won: "success",
  lost: "danger",
};

export function OpportunityRow({ organizationSlug, opportunity, stageName, ownerName }: { organizationSlug: string; opportunity: CrmOpportunity; stageName: string; ownerName: string }) {
  return (
    <Tr>
      <Td>
        <Link href={`/app/${organizationSlug}/crm/opportunities/${opportunity.id}`} className="lynq-transition font-medium text-foreground hover:text-accent-foreground">
          {opportunity.name}
        </Link>
      </Td>
      <Td className="hidden text-muted sm:table-cell">{stageName}</Td>
      <Td>
        <Badge tone={STATUS_TONE[opportunity.status] ?? "neutral"}>{opportunity.status}</Badge>
      </Td>
      <Td className="hidden text-muted md:table-cell">{opportunity.amount ? `${opportunity.amount} ${opportunity.currency ?? ""}` : "—"}</Td>
      <Td className="hidden text-muted lg:table-cell">{ownerName}</Td>
    </Tr>
  );
}
