import Link from "next/link";
import type { WorkflowExecution } from "@/lib/workflows/executions";
import { Tr, Td } from "@/components/ui/Table";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

const STATUS_TONE: Record<string, BadgeTone> = {
  queued: "neutral",
  running: "info",
  waiting: "warning",
  waiting_for_approval: "warning",
  paused: "warning",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
};

export function ExecutionRow({ organizationSlug, execution, workflowName }: { organizationSlug: string; execution: WorkflowExecution; workflowName: string }) {
  return (
    <Tr>
      <Td>
        <Link href={`/app/${organizationSlug}/workflow-executions/${execution.id}`} className="lynq-transition font-medium text-foreground hover:text-accent-foreground">
          {workflowName}
        </Link>
      </Td>
      <Td>
        <Badge tone={STATUS_TONE[execution.status] ?? "neutral"}>{execution.status.replace(/_/g, " ")}</Badge>
      </Td>
      <Td className="hidden text-muted sm:table-cell">{execution.startedAt ? execution.startedAt.toLocaleString() : "Not started yet"}</Td>
      <Td className="hidden text-muted md:table-cell">{execution.completedAt ? execution.completedAt.toLocaleString() : "—"}</Td>
    </Tr>
  );
}
