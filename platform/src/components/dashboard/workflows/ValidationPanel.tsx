"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import type { WorkflowValidationResult } from "@/lib/workflows/graph-validation";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

const initialState: ActionResult & { validation?: WorkflowValidationResult } = { ok: true };

export function ValidationPanel({ lastResult, action }: { lastResult: WorkflowValidationResult | null; action: () => Promise<ActionResult & { validation?: unknown }> }) {
  const [state, formAction] = useActionState(async () => action(), initialState);
  const result = (state.ok ? (state.validation as WorkflowValidationResult | undefined) : undefined) ?? lastResult;

  return (
    <Card padding="sm" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-xs uppercase tracking-[0.1em] text-subtle">Validation</h3>
          {result ? <Badge tone={result.valid ? "success" : "danger"}>{result.valid ? "Valid" : `${result.issues.length} issue${result.issues.length === 1 ? "" : "s"}`}</Badge> : null}
        </div>
        <form action={formAction}>
          <SubmitButton variant="glass" pendingLabel="Validating…">
            Run validation
          </SubmitButton>
        </form>
      </div>
      {!state.ok ? <p role="alert" className="rounded-sm border border-danger/30 bg-danger-wash px-3 py-2 text-sm text-danger">{state.message}</p> : null}
      {result ? (
        result.valid ? (
          <p role="status" className="rounded-sm border border-success/30 bg-success-wash px-3 py-2 text-sm text-success">Valid — ready to publish.</p>
        ) : (
          <ul role="alert" className="flex flex-col gap-1 rounded-sm border border-danger/30 bg-danger-wash px-3 py-2 text-sm text-danger">
            {result.issues.map((issue, index) => (
              <li key={index}>
                {issue.nodeKey ? <span className="font-medium">[{issue.nodeKey}] </span> : null}
                {issue.message}
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className="text-sm text-muted">Not yet validated.</p>
      )}
    </Card>
  );
}
