"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import type { CrmNote } from "@/lib/crm/notes";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";
import { Card } from "@/components/ui/Card";

const initialState: ActionResult = { ok: true };

export function NoteCard({ note, authorName, redirectPath, archiveAction }: { note: CrmNote; authorName: string; redirectPath: string; archiveAction: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => archiveAction(formData), initialState);

  return (
    <Card as="li" padding="sm" className="flex flex-col gap-2 text-sm">
      <p className="whitespace-pre-wrap text-foreground">{note.content}</p>
      <div className="flex items-center justify-between text-xs text-subtle">
        <span>
          {authorName} · {note.createdAt.toLocaleDateString()}
        </span>
        <form action={formAction}>
          <input type="hidden" name="expectedRevision" value={note.revision} />
          <input type="hidden" name="redirectPath" value={redirectPath} />
          <SubmitButton variant="danger">Archive</SubmitButton>
        </form>
      </div>
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
    </Card>
  );
}
