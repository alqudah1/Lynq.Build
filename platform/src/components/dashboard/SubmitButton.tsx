"use client";

import { useFormStatus } from "react-dom";

const BASE = "lynq-transition inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-5 text-xs font-medium uppercase tracking-[0.08em] disabled:pointer-events-none disabled:opacity-50";

const VARIANT = {
  /** Solid, high-contrast — the one primary action per view. */
  primary: "bg-foreground text-background hover:opacity-90",
  /** Translucent "glass" button — secondary actions that still need real presence. */
  glass: "lynq-glass text-foreground hover:border-border-strong hover:bg-glass-strong",
  /** Minimal, text-only — tertiary/inline actions. */
  ghost: "text-muted hover:text-foreground",
  /** Reserved for genuinely destructive or state-reverting actions only. */
  danger: "border border-danger/40 bg-danger-wash text-danger hover:border-danger/70",
} as const;

/** A submit button that disables itself and shows a pending label while its enclosing form action is in flight — the form's own loading state, not a separately-tracked one. */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  name,
  value,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: keyof typeof VARIANT;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" name={name} value={value} disabled={pending} className={`${BASE} ${VARIANT[variant]}`}>
      {pending ? (
        <>
          <span aria-hidden="true" className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
          {pendingLabel ?? "Saving…"}
        </>
      ) : (
        children
      )}
    </button>
  );
}
