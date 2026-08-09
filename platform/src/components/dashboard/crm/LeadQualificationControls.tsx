"use client";

import { useActionState, useState } from "react";
import type { CrmLeadStatus } from "@/lib/crm/validation";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const initialState: ActionResult = { ok: true };

function ActionForm({ expectedRevision, action, label, variant, extraFields }: { expectedRevision: number; action: (formData: FormData) => Promise<ActionResult>; label: string; variant?: "primary" | "danger"; extraFields?: React.ReactNode }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="expectedRevision" value={expectedRevision} />
      {extraFields}
      <SubmitButton variant={variant}>{label}</SubmitButton>
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
    </form>
  );
}

const QUALIFIABLE: CrmLeadStatus[] = ["new", "contacted", "engaged"];
const DISQUALIFIABLE: CrmLeadStatus[] = ["new", "contacted", "engaged", "qualified"];

/**
 * Explicit, auditable qualification lifecycle controls — status never
 * changes silently or automatically; each button submits its own
 * dedicated, separately-audited server action (`qualify`, `disqualify`,
 * `convert`), never a generic status dropdown.
 */
export function LeadQualificationControls({
  status,
  expectedRevision,
  canManage,
  pipelines,
  qualifyAction,
  disqualifyAction,
  convertAction,
}: {
  status: CrmLeadStatus;
  expectedRevision: number;
  canManage: boolean;
  pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[];
  qualifyAction: (formData: FormData) => Promise<ActionResult>;
  disqualifyAction: (formData: FormData) => Promise<ActionResult>;
  convertAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? "");
  if (!canManage) return null;
  const selectedPipeline = pipelines.find((p) => p.id === pipelineId);

  return (
    <div className="flex flex-col gap-4">
      {QUALIFIABLE.includes(status) ? <ActionForm expectedRevision={expectedRevision} action={qualifyAction} label="Qualify" /> : null}
      {DISQUALIFIABLE.includes(status) ? <ActionForm expectedRevision={expectedRevision} action={disqualifyAction} label="Disqualify" variant="danger" /> : null}
      {status === "qualified" && pipelines.length > 0 ? (
        <ActionForm
          expectedRevision={expectedRevision}
          action={convertAction}
          label="Convert to opportunity"
          extraFields={
            <>
              <SelectField label="Pipeline" name="pipelineId" value={pipelineId} onChange={setPipelineId} options={pipelines.map((p) => ({ value: p.id, label: p.name }))} />
              <SelectField label="Stage" name="stageId" options={(selectedPipeline?.stages ?? []).map((s) => ({ value: s.id, label: s.name }))} />
            </>
          }
        />
      ) : null}
      {status === "converted" ? <p className="text-sm text-muted">This lead has already been converted.</p> : null}
    </div>
  );
}
