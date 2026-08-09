"use client";

import { useActionState } from "react";
import { updateWorkspaceAction } from "@/lib/dashboard/actions/workspaces";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { FormField } from "./FormField";
import { SubmitButton } from "./SubmitButton";
import { StatusMessage } from "./StatusMessage";

const initialState: ActionResult = { ok: true };

export function WorkspaceSettingsForm({
  organizationSlug,
  workspaceSlug,
  name,
  slug,
}: {
  organizationSlug: string;
  workspaceSlug: string;
  name: string;
  slug: string;
}) {
  const [state, formAction] = useActionState(
    async (_prev: ActionResult, formData: FormData) => updateWorkspaceAction(organizationSlug, workspaceSlug, formData),
    initialState
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormField label="Workspace name" name="name" defaultValue={name} required error={!state.ok ? state.fieldErrors?.name : undefined} />
      <FormField
        label="Slug"
        name="slug"
        defaultValue={slug}
        required
        hint="Changing this changes the workspace's dashboard URL."
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
