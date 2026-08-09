"use client";

import { useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";

/**
 * A reusable confirmation modal for destructive or privilege-changing
 * operations (Step 5B: role changes, member removal, organization/
 * workspace deletion). The mutation itself only ever runs when the
 * CONFIRM button inside the dialog is actually submitted — clicking the
 * trigger only opens the dialog, never performs the action.
 *
 * Accessible dialog pattern: `role="dialog" aria-modal="true"`, labelled
 * and described by its own title/description, focus moves to the Cancel
 * button on open and returns to the trigger button on close (Escape,
 * Cancel, or a successful submit), matching the same pattern already
 * proven in `MobileNav` (Step 5A).
 *
 * `formAction` is a server action (already bound with whatever IDs it
 * needs via `.bind(null, ...)` at the call site — never a raw client-
 * supplied ID deciding authorization, only which existing, already-
 * validated row the call targets). `hiddenFields` carries any additional,
 * dynamically-chosen value (e.g. a newly-selected role) the action needs.
 */
export function ConfirmDialog({
  triggerLabel,
  title,
  description,
  confirmLabel,
  formAction,
  hiddenFields,
  variant = "default",
  triggerVariant = "default",
  disabled,
}: {
  triggerLabel: string;
  title: string;
  description: string;
  confirmLabel: string;
  formAction: (formData: FormData) => Promise<ActionResult>;
  hiddenFields?: Record<string, string>;
  variant?: "default" | "danger";
  triggerVariant?: "default" | "danger" | "subtle";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) cancelButtonRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function close() {
    setOpen(false);
    setError(null);
    triggerRef.current?.focus();
  }

  async function handleConfirm(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await formAction(formData);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    close();
  }

  const triggerToneClass =
    triggerVariant === "danger"
      ? "border border-danger/40 bg-danger-wash text-danger hover:border-danger/70"
      : triggerVariant === "subtle"
        ? "text-muted hover:text-foreground"
        : "border border-border text-foreground hover:border-border-strong";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={`lynq-transition min-h-11 rounded-sm px-4 text-xs font-medium uppercase tracking-[0.08em] disabled:opacity-50 ${triggerToneClass}`}
      >
        {triggerLabel}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby="confirm-dialog-description"
            className="lynq-glass-strong w-full max-w-sm rounded-lg p-6 shadow-lg motion-safe:animate-[lynq-dialog-in_180ms_var(--lynq-ease)]"
          >
            <h2 id="confirm-dialog-title" className="font-serif text-lg italic font-light text-foreground">
              {title}
            </h2>
            <p id="confirm-dialog-description" className="mt-2 text-sm text-muted">
              {description}
            </p>
            {error ? (
              <p role="alert" className="mt-3 rounded-sm border border-danger/30 bg-danger-wash px-3 py-2 text-xs text-danger">
                {error}
              </p>
            ) : null}
            <form action={handleConfirm} className="mt-5 flex justify-end gap-3">
              {hiddenFields
                ? Object.entries(hiddenFields).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)
                : null}
              <button
                ref={cancelButtonRef}
                type="button"
                onClick={close}
                className="lynq-transition min-h-11 rounded-sm px-4 text-xs font-medium uppercase tracking-[0.08em] text-muted hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className={`lynq-transition min-h-11 rounded-sm px-4 text-xs font-medium uppercase tracking-[0.08em] disabled:opacity-50 ${
                  variant === "danger" ? "border border-danger/40 bg-danger-wash text-danger hover:border-danger/70" : "bg-foreground text-background hover:opacity-90"
                }`}
              >
                {pending ? "Working…" : confirmLabel}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
