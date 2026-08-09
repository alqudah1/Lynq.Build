import Link from "next/link";
import type { WorkflowDefinition } from "@/lib/workflows/definitions";
import { Tr, Td } from "@/components/ui/Table";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: "neutral",
  published: "success",
  paused: "warning",
  archived: "neutral",
};

export function WorkflowRow({ organizationSlug, workflow, workspaceName }: { organizationSlug: string; workflow: WorkflowDefinition; workspaceName: string | null }) {
  return (
    <Tr>
      <Td>
        <Link href={`/app/${organizationSlug}/workflows/${workflow.id}`} className="lynq-transition font-medium text-foreground hover:text-accent-foreground">
          {workflow.name}
        </Link>
      </Td>
      <Td className="text-xs uppercase tracking-[0.08em] text-subtle">{workflow.workflowKey}</Td>
      <Td>
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONE[workflow.status] ?? "neutral"}>{workflow.status}</Badge>
          {workflow.isTemplate ? <Badge tone="accent">Template</Badge> : null}
        </div>
      </Td>
      <Td className="hidden text-muted md:table-cell">{workspaceName ?? "Organization-wide"}</Td>
      <Td className="hidden text-muted sm:table-cell">{workflow.updatedAt.toLocaleDateString()}</Td>
    </Tr>
  );
}
