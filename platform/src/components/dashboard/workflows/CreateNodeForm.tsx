"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { FormField } from "@/components/dashboard/FormField";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";
import { WORKFLOW_NODE_TYPES } from "@/lib/workflows/validation";
import { AGENT_TASK_TYPES } from "@/lib/agent-runtime/task-types";

const initialState: ActionResult = { ok: true };

const NODE_TYPE_OPTIONS = WORKFLOW_NODE_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, " ") }));

const CONFIG_HINTS: Record<string, string> = {
  start: "{}",
  end: '{ "requiredOutputs": [] }',
  agent_execution: `{ "agentId": "<registered-agent-id>", "agentTaskType": "<one of: ${AGENT_TASK_TYPES.join(", ")}>" }`,
  tool_invocation: '{ "agentId": "<agent-id>", "toolKey": "brain.search" }',
  human_task: '{ "assignedUserId": "<user-id>", "title": "...", "instructions": "..." }',
  approval: '{ "agentId": "<agent-id>", "requestedAction": "...", "summary": "...", "riskLevel": "low" }',
  condition: '{ "branches": [{ "branchKey": "yes", "operator": "equals", "left": { "source": "workflow_input", "path": "x" }, "right": true }], "defaultBranchKey": "no" }',
  wait: '{ "durationSeconds": 3600 }',
  project_task: '{ "createNew": true, "title": "..." }',
  artifact_transform: '{ "agentId": "<agent-id>", "title": "...", "sourceOutputKeys": ["previous_node_key"] }',
};

/** A simple, accessible structured builder — deliberately not a drag-and-drop canvas. Node type drives which configuration shape is expected (shown as a hint); the actual configuration is bounded JSON, validated server-side against that exact type's schema before it is ever stored. */
export function CreateNodeForm({ action }: { action: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);
  const [nodeType, setNodeType] = useState<string>("start");

  return (
    <form action={formAction} className="flex flex-col gap-4 border border-border p-4">
      <h3 className="text-xs uppercase tracking-[0.1em] text-subtle">Add node</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Node key" name="nodeKey" required hint="lowercase_snake_case, unique within this version" />
        <FormField label="Name" name="name" required />
      </div>
      <SelectField label="Node type" name="nodeType" value={nodeType} onChange={setNodeType} options={NODE_TYPE_OPTIONS} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="configuration" className="text-xs uppercase tracking-[0.1em] text-subtle">
          Configuration (JSON)
        </label>
        <textarea id="configuration" name="configuration" rows={3} placeholder={CONFIG_HINTS[nodeType]} className="border border-border bg-background px-3 py-2 font-mono text-xs text-foreground" />
        <p className="text-xs text-subtle">Expected shape for &quot;{nodeType}&quot;: {CONFIG_HINTS[nodeType]}</p>
        {nodeType === "agent_execution" ? (
          <p className="text-xs text-subtle">
            <code>agentTaskType</code> must be one the referenced agent is registered for — <code>company_knowledge_report</code> (Company Knowledge Analyst), <code>sales_lead_research</code> (Lead Research Assistant), or{" "}
            <code>sales_opportunity_summary</code> (Opportunity Summary Assistant). An optional <code>expectedOutputKey</code> fails this node deterministically if the completed task&apos;s result is missing that key.
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="inputMapping" className="text-xs uppercase tracking-[0.1em] text-subtle">
          Input mapping (JSON, optional)
        </label>
        <textarea id="inputMapping" name="inputMapping" rows={2} placeholder='{ "topic": { "source": "workflow_input", "path": "topic" } }' className="border border-border bg-background px-3 py-2 font-mono text-xs text-foreground" />
      </div>
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
      <div>
        <SubmitButton>Add node</SubmitButton>
      </div>
    </form>
  );
}
