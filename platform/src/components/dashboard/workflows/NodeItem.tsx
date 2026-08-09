"use client";

import { useActionState } from "react";
import type { WorkflowNode } from "@/lib/workflows/nodes";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

const initialState: ActionResult = { ok: true };

const NODE_TYPE_TONE: Record<string, BadgeTone> = {
  start: "success",
  end: "danger",
  agent_execution: "accent",
  tool_invocation: "info",
  human_task: "warning",
  approval: "warning",
  condition: "info",
  wait: "neutral",
  project_task: "accent",
  artifact_transform: "info",
};

function EditNodeConfigForm({ node, updateAction }: { node: WorkflowNode; updateAction: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => updateAction(formData), initialState);

  return (
    <form action={formAction} className="mt-2 flex flex-col gap-2">
      <label htmlFor={`config-${node.id}`} className="text-xs uppercase tracking-[0.1em] text-subtle">
        Configuration (JSON)
      </label>
      <textarea id={`config-${node.id}`} name="configuration" rows={4} defaultValue={JSON.stringify(node.configuration, null, 2)} className="lynq-transition rounded-sm border border-border bg-elevated px-3 py-2 font-mono text-xs text-foreground focus-visible:border-accent/60" />
      <label htmlFor={`mapping-${node.id}`} className="text-xs uppercase tracking-[0.1em] text-subtle">
        Input mapping (JSON)
      </label>
      <textarea id={`mapping-${node.id}`} name="inputMapping" rows={2} defaultValue={JSON.stringify(node.inputMapping, null, 2)} className="lynq-transition rounded-sm border border-border bg-elevated px-3 py-2 font-mono text-xs text-foreground focus-visible:border-accent/60" />
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
      <div>
        <SubmitButton pendingLabel="Saving…">Save configuration</SubmitButton>
      </div>
    </form>
  );
}

/** A visual node card — node type as a color-coded badge (doubles as a quick-scan legend across a version's whole node list), name, stable key, and its configuration behind a disclosure. Deliberately a structured card list, never a drag-and-drop canvas. */
export function NodeItem({ node, canEdit, deleteAction, updateAction }: { node: WorkflowNode; canEdit: boolean; deleteAction: (formData: FormData) => Promise<ActionResult>; updateAction: (formData: FormData) => Promise<ActionResult> }) {
  return (
    <Card as="li" padding="sm" className="list-none">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Badge tone={NODE_TYPE_TONE[node.nodeType] ?? "neutral"} dot>
            {node.nodeType.replace(/_/g, " ")}
          </Badge>
          <div>
            <p className="text-sm font-medium text-foreground">{node.name}</p>
            <p className="text-xs text-subtle">{node.nodeKey}</p>
          </div>
        </div>
        {canEdit ? <ConfirmDialog triggerLabel="Delete" triggerVariant="danger" variant="danger" title="Delete node" description={`Delete node "${node.name}"? Any edges connected to it will also be removed.`} confirmLabel="Delete" formAction={deleteAction} /> : null}
      </div>
      <details className="mt-3">
        <summary className="lynq-transition cursor-pointer text-xs uppercase tracking-[0.08em] text-subtle hover:text-foreground">Configuration</summary>
        {canEdit ? (
          <EditNodeConfigForm node={node} updateAction={updateAction} />
        ) : (
          <>
            <pre className="mt-2 overflow-x-auto rounded-sm border border-border bg-elevated p-2 text-xs text-muted">{JSON.stringify(node.configuration, null, 2)}</pre>
            {Object.keys(node.inputMapping).length > 0 ? (
              <>
                <p className="mt-2 text-xs uppercase tracking-[0.08em] text-subtle">Input mapping</p>
                <pre className="mt-1 overflow-x-auto rounded-sm border border-border bg-elevated p-2 text-xs text-muted">{JSON.stringify(node.inputMapping, null, 2)}</pre>
              </>
            ) : null}
          </>
        )}
      </details>
    </Card>
  );
}
