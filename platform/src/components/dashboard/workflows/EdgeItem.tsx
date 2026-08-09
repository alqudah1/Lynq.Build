import type { WorkflowEdge } from "@/lib/workflows/edges";
import type { WorkflowNode } from "@/lib/workflows/nodes";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";

export function EdgeItem({ edge, nodesById, canEdit, deleteAction }: { edge: WorkflowEdge; nodesById: Map<string, WorkflowNode>; canEdit: boolean; deleteAction: (formData: FormData) => Promise<ActionResult> }) {
  const source = nodesById.get(edge.sourceNodeId);
  const target = nodesById.get(edge.targetNodeId);

  return (
    <li className="lynq-transition flex flex-wrap items-center justify-between gap-2 border-b border-border py-2.5 text-sm hover:bg-white/[0.02]">
      <span className="flex items-center gap-2 text-foreground">
        <span className="rounded-sm border border-border px-2 py-0.5 text-xs">{source?.name ?? "?"}</span>
        <span aria-hidden="true" className="text-subtle">
          →
        </span>
        <span className="rounded-sm border border-border px-2 py-0.5 text-xs">{target?.name ?? "?"}</span>
        {edge.conditionKey ? <span className="ml-1 text-xs uppercase tracking-[0.08em] text-subtle">if {edge.conditionKey}</span> : null}
      </span>
      {canEdit ? <ConfirmDialog triggerLabel="Remove" triggerVariant="danger" variant="danger" title="Remove edge" description={`Remove the edge from "${source?.name}" to "${target?.name}"?`} confirmLabel="Remove" formAction={deleteAction} /> : null}
    </li>
  );
}
