"use client";

import { useActionState } from "react";
import { createOrganizationAction } from "@/lib/dashboard/actions/organizations";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { FormField } from "./FormField";
import { SubmitButton } from "./SubmitButton";
import { StatusMessage } from "./StatusMessage";

const initialState: ActionResult = { ok: true };

export function CreateOrganizationForm() {
  const [state, formAction] = useActionState(
    async (_prev: ActionResult, formData: FormData) => createOrganizationAction(formData),
    initialState
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormField
        label="Organization name"
        name="name"
        required
        autoComplete="organization"
        error={!state.ok ? state.fieldErrors?.name : undefined}
      />
      <FormField
        label="Slug"
        name="slug"
        required
        hint="Lowercase letters, numbers, and hyphens only — this becomes part of your dashboard URL."
        error={!state.ok ? state.fieldErrors?.slug : undefined}
      />
      {!state.ok && !state.fieldErrors ? <StatusMessage tone="error" message={state.message} /> : null}
      <div>
        <SubmitButton>Create organization</SubmitButton>
      </div>
    </form>
  );
}
