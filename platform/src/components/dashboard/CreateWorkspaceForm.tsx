"use client";

import { useActionState } from "react";
import { createWorkspaceAction } from "@/lib/dashboard/actions/workspaces";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { FormField } from "./FormField";
import { SubmitButton } from "./SubmitButton";
import { StatusMessage } from "./StatusMessage";

const initialState: ActionResult = { ok: true };

export function CreateWorkspaceForm({ organizationSlug }: { organizationSlug: string }) {
  const [state, formAction] = useActionState(
    async (_prev: ActionResult, formData: FormData) => createWorkspaceAction(organizationSlug, formData),
    initialState
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormField label="Workspace name" name="name" required error={!state.ok ? state.fieldErrors?.name : undefined} />
      <FormField
        label="Slug"
        name="slug"
        required
        hint="Lowercase letters, numbers, and hyphens only — unique within this organization."
        error={!state.ok ? state.fieldErrors?.slug : undefined}
      />
      {!state.ok && !state.fieldErrors ? <StatusMessage tone="error" message={state.message} /> : null}
      <div>
        <SubmitButton>Create workspace</SubmitButton>
      </div>
    </form>
  );
}
