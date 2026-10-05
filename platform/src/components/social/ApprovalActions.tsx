import Link from "next/link";
import { decideVariantApprovalAction } from "@/lib/dashboard/actions/social";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { formatDateTime, toDateTimeLocalValue } from "./format";

/**
 * The decision controls for one post awaiting review. Mobile-first: on
 * phone widths the two decisive actions (Approve / Request changes) sit in
 * a sticky bar at the bottom of the card with full-width buttons; the
 * secondary actions (publish now, reject, change time, edit) follow below.
 * Every decision goes through `decideVariantApproval` — the same runtime
 * approval model as the Founder Approval Center.
 */
export function ApprovalActions({
  organizationSlug,
  variantId,
  revision,
  scheduledFor,
  timeZone,
  canPublish,
  editHref,
  blocked,
}: {
  organizationSlug: string;
  variantId: string;
  revision: number;
  scheduledFor: Date | null;
  timeZone: string;
  canPublish: boolean;
  editHref: string;
  blocked: boolean;
}) {
  const decide = decideVariantApprovalAction.bind(null, organizationSlug, variantId);
  const rev = String(revision);
  const scheduleLabel = scheduledFor && canPublish ? `Approve & schedule for ${formatDateTime(scheduledFor, timeZone)}` : "Approve";

  return (
    <div className="flex flex-col gap-3">
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-border bg-elevated/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        {blocked ? <p className="text-xs text-danger">Fix the blocking warnings before approving.</p> : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
          <ActionForm action={decide} hiddenFields={{ expectedRevision: rev, decision: "approve" }} className="flex flex-col gap-2 [&_button]:w-full sm:[&_button]:w-auto">
            <SubmitButton pendingLabel="Approving…">{scheduleLabel}</SubmitButton>
          </ActionForm>
          <details className="group flex flex-col sm:min-w-64">
            <summary className="lynq-glass lynq-transition flex min-h-11 cursor-pointer list-none items-center justify-center rounded-sm px-5 text-xs font-medium uppercase tracking-[0.08em] text-foreground hover:border-border-strong [&::-webkit-details-marker]:hidden">Request changes</summary>
            <ActionForm action={decide} hiddenFields={{ expectedRevision: rev, decision: "request_changes" }} className="mt-2 flex flex-col gap-2 [&_button]:w-full">
              <label htmlFor={`note-${variantId}`} className="text-xs uppercase tracking-[0.1em] text-subtle">What should change?</label>
              <textarea id={`note-${variantId}`} name="note" required maxLength={2000} rows={3} className="lynq-transition w-full rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground hover:border-border-strong focus-visible:border-accent/60" />
              <SubmitButton variant="glass" pendingLabel="Sending…">Send back with note</SubmitButton>
            </ActionForm>
          </details>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center [&>button]:w-full sm:[&>button]:w-auto">
        {canPublish ? (
          <ConfirmDialog
            triggerLabel="Approve & publish now"
            title="Publish this post now?"
            description="It will be approved and sent to the platform immediately. This posts publicly."
            confirmLabel="Approve & publish"
            formAction={decide}
            hiddenFields={{ expectedRevision: rev, decision: "approve", publishNow: "1" }}
          />
        ) : null}
        <ConfirmDialog
          triggerLabel="Reject"
          triggerVariant="danger"
          variant="danger"
          title="Reject this post?"
          description="It will be marked rejected. The author can return it to draft and rework it."
          confirmLabel="Reject"
          formAction={decide}
          hiddenFields={{ expectedRevision: rev, decision: "reject" }}
        />
        <Link href={editHref} className="lynq-transition inline-flex min-h-11 items-center justify-center rounded-sm px-4 text-xs font-medium uppercase tracking-[0.08em] text-muted hover:text-foreground">Edit</Link>
      </div>

      {canPublish ? (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-xs text-muted hover:text-foreground">{scheduledFor ? "Approve for a different time" : "Approve and schedule"}</summary>
          <ActionForm action={decide} hiddenFields={{ expectedRevision: rev, decision: "approve" }} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end [&_button]:w-full sm:[&_button]:w-auto">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-[0.1em] text-subtle">Publish at ({timeZone})</span>
              <input type="datetime-local" name="scheduledFor" required defaultValue={toDateTimeLocalValue(scheduledFor, timeZone)} className="lynq-transition min-h-11 rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground hover:border-border-strong focus-visible:border-accent/60" />
            </label>
            <SubmitButton variant="glass" pendingLabel="Scheduling…">Approve & schedule</SubmitButton>
          </ActionForm>
        </details>
      ) : null}
    </div>
  );
}
