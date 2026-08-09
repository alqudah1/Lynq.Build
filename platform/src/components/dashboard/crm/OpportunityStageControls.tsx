"use client";

import { useActionState, useState } from "react";
import type { CrmOpportunityStatus } from "@/lib/crm/validation";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { FormField } from "@/components/dashboard/FormField";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const initialState: ActionResult = { ok: true };

/**
 * A closed (won/lost) opportunity never silently reopens — moving stage
 * is only ever offered while `status === "open"`; once closed, the only
 * control shown is the explicit "Reopen" form, targeting a specifically
 * chosen non-closed stage.
 */
export function OpportunityStageControls({
  status,
  expectedRevision,
  canManage,
  allStages,
  openStages,
  moveAction,
  reopenAction,
}: {
  status: CrmOpportunityStatus;
  expectedRevision: number;
  canManage: boolean;
  allStages: { id: string; name: string }[];
  openStages: { id: string; name: string }[];
  moveAction: (formData: FormData) => Promise<ActionResult>;
  reopenAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const [moveState, moveFormAction] = useActionState(async (_prev: ActionResult, formData: FormData) => moveAction(formData), initialState);
  const [reopenState, reopenFormAction] = useActionState(async (_prev: ActionResult, formData: FormData) => reopenAction(formData), initialState);
  const [targetStageId, setTargetStageId] = useState(allStages[0]?.id ?? "");

  if (!canManage) return null;

  if (status !== "open") {
    return (
      <form action={reopenFormAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="expectedRevision" value={expectedRevision} />
        <SelectField label="Reopen into stage" name="targetStageId" options={openStages.map((s) => ({ value: s.id, label: s.name }))} />
        <SubmitButton>Reopen</SubmitButton>
        {!reopenState.ok ? <StatusMessage tone="error" message={reopenState.message} /> : null}
      </form>
    );
  }

  return (
    <form action={moveFormAction} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="expectedRevision" value={expectedRevision} />
        <SelectField label="Move to stage" name="targetStageId" value={targetStageId} onChange={setTargetStageId} options={allStages.map((s) => ({ value: s.id, label: s.name }))} />
        <FormField label="Lost reason (if moving to a lost stage)" name="lostReason" />
        <SubmitButton>Move</SubmitButton>
      </div>
      {!moveState.ok ? <StatusMessage tone="error" message={moveState.message} /> : null}
    </form>
  );
}
