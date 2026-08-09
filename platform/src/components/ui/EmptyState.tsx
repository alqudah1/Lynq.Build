import type { ReactNode } from "react";

/**
 * The shared "nothing here yet" block — replaces the ad hoc `<p
 * className="text-sm text-muted">No X yet.</p>` pattern repeated across
 * every list page. Never fabricates a fake preview or placeholder metric;
 * `action` is optional and only ever a real, functioning control.
 */
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-border px-6 py-10">
      <p className="text-sm text-foreground">{title}</p>
      {description ? <p className="text-sm text-subtle">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
