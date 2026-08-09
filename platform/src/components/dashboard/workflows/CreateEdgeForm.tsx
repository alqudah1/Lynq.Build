"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const initialState: ActionResult = { ok: true };

export function CreateEdgeForm({ nodes, action }: { nodes: { id: string; name: string }[]; action: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);

  if (nodes.length < 2) return <p className="text-sm text-muted">Add at least two nodes before connecting them.</p>;

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 border border-border p-4">
      <SelectField label="From" name="sourceNodeId" options={nodes.map((n) => ({ value: n.id, label: n.name }))} />
      <SelectField label="To" name="targetNodeId" options={nodes.map((n) => ({ value: n.id, label: n.name }))} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="conditionKey" className="text-xs uppercase tracking-[0.1em] text-subtle">
          Condition key (only for edges out of a condition node)
        </label>
        <input id="conditionKey" name="conditionKey" className="min-h-11 border border-border bg-background px-3 py-2 text-sm text-foreground" />
      </div>
      <SubmitButton>Add edge</SubmitButton>
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
    </form>
  );
}
