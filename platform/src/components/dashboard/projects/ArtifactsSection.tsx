"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import type { ProjectArtifactLink } from "@/lib/projects/links";
import { FormField } from "@/components/dashboard/FormField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

const initialState: ActionResult = { ok: true };

/** Project-level linking only, in this UI — the underlying API/service already supports linking to a phase/milestone/task too; this form deliberately stays to the simplest, least error-prone case for now. */
export function ArtifactsSection({ links, projectId, action }: { links: ProjectArtifactLink[]; projectId: string; action: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);

  return (
    <div className="flex flex-col gap-6">
      {links.length === 0 ? (
        <EmptyState title="No artifacts linked yet." description="Link one below by its id (e.g. from a Knowledge Analyst report)." />
      ) : (
        <ul className="flex flex-col gap-2">
          {links.map((link) => (
            <Card as="li" key={link.id} padding="sm" className="text-sm text-foreground">
              Artifact <span className="text-muted">{link.artifactId}</span>
            </Card>
          ))}
        </ul>
      )}

      <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-md border border-border p-4">
        <div className="min-w-64 flex-1">
          <FormField label="Artifact id" name="artifactId" required hint="The id of an existing Runtime artifact (e.g. a report)." error={!state.ok ? state.fieldErrors?.artifactId : undefined} />
        </div>
        <input type="hidden" name="linkedEntityType" value="project" />
        <input type="hidden" name="linkedEntityId" value={projectId} />
        <SubmitButton>Link artifact</SubmitButton>
        {!state.ok && !state.fieldErrors ? <StatusMessage tone="error" message={state.message} /> : null}
      </form>
    </div>
  );
}
