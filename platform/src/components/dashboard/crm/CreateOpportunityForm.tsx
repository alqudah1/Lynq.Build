"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { FormField } from "@/components/dashboard/FormField";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const initialState: ActionResult = { ok: true };

/** Monetary value is never required — `amount` is a plain optional field. */
export function CreateOpportunityForm({
  pipelines,
  contacts,
  companies,
  action,
}: {
  pipelines: { id: string; name: string; stages: { id: string; name: string; isClosed: boolean }[] }[];
  contacts: { id: string; name: string }[];
  companies: { id: string; name: string }[];
  action: (formData: FormData) => Promise<ActionResult>;
}) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? "");
  const selectedPipeline = pipelines.find((p) => p.id === pipelineId);
  const openStages = (selectedPipeline?.stages ?? []).filter((s) => !s.isClosed);

  if (pipelines.length === 0) return <p className="text-sm text-muted">Create a pipeline with at least one open stage first.</p>;

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-md border border-border p-4">
      <h3 className="text-xs uppercase tracking-[0.1em] text-subtle">New opportunity</h3>
      <FormField label="Name" name="name" required error={!state.ok ? state.fieldErrors?.name : undefined} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Pipeline" name="pipelineId" value={pipelineId} onChange={setPipelineId} options={pipelines.map((p) => ({ value: p.id, label: p.name }))} />
        <SelectField label="Stage" name="stageId" options={openStages.map((s) => ({ value: s.id, label: s.name }))} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Primary contact" name="primaryContactId" options={[{ value: "", label: "None" }, ...contacts.map((c) => ({ value: c.id, label: c.name }))]} />
        <SelectField label="Company" name="companyId" options={[{ value: "", label: "None" }, ...companies.map((c) => ({ value: c.id, label: c.name }))]} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Amount" name="amount" type="number" hint="Optional" error={!state.ok ? state.fieldErrors?.amount : undefined} />
        <FormField label="Currency" name="currency" placeholder="USD" error={!state.ok ? state.fieldErrors?.currency : undefined} />
      </div>
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
      <div>
        <SubmitButton>Create opportunity</SubmitButton>
      </div>
    </form>
  );
}
