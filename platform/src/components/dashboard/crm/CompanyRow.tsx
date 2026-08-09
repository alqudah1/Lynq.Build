import Link from "next/link";
import type { CrmCompany } from "@/lib/crm/companies";
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

export function CompanyRow({ organizationSlug, company, ownerName }: { organizationSlug: string; company: CrmCompany; ownerName: string }) {
  return (
    <Tr>
      <Td>
        <Link href={`/app/${organizationSlug}/crm/companies/${company.id}`} className="lynq-transition font-medium text-foreground hover:text-accent-foreground">
          {company.name}
        </Link>
      </Td>
      <Td className="hidden text-muted sm:table-cell">{company.domain ?? "—"}</Td>
      <Td className="hidden text-muted md:table-cell">{company.industry ?? "—"}</Td>
      <Td>
        <Badge tone={LIFECYCLE_TONE[company.lifecycleStage] ?? "neutral"}>{company.lifecycleStage.replace(/_/g, " ")}</Badge>
      </Td>
      <Td className="hidden text-muted lg:table-cell">{ownerName}</Td>
    </Tr>
  );
}
