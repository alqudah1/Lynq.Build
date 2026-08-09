"use client";

import { useActionState } from "react";
import { updateOrganizationAction } from "@/lib/dashboard/actions/organizations";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { FormField } from "./FormField";
import { SubmitButton } from "./SubmitButton";
import { StatusMessage } from "./StatusMessage";

const initialState: ActionResult = { ok: true };

/** Editable only for owner/admin — the settings PAGE conditionally renders this vs. a read-only view based on the actor's role, but the real authorization gate is `updateOrganization` itself, unchanged, regardless of what the UI shows. */
export function OrganizationSettingsForm({ organizationSlug, name, slug }: { organizationSlug: string; name: string; slug: string }) {
  const [state, formAction] = useActionState(
    async (_prev: ActionResult, formData: FormData) => updateOrganizationAction(organizationSlug, formData),
    initialState
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormField label="Organization name" name="name" defaultValue={name} required error={!state.ok ? state.fieldErrors?.name : undefined} />
      <FormField
        label="Slug"
        name="slug"
        defaultValue={slug}
        required
        hint="Changing this changes your dashboard URL."
        error={!state.ok ? state.fieldErrors?.slug : undefined}
      />
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
      {state.ok && state !== initialState ? <StatusMessage tone="success" message="Changes saved." /> : null}
      <div>
        <SubmitButton>Save changes</SubmitButton>
      </div>
    </form>
  );
}
