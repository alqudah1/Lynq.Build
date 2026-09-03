"use client";

import type { SiteSection } from "@/lib/office/website/spec";

type ContactSection = Extract<SiteSection, { kind: "contact" }>;
type FormSpec = NonNullable<ContactSection["form"]>;

/**
 * The booking / lead flow for a prospect demo.
 *
 * It behaves like a real form — labels, required fields, keyboard order,
 * browser validation, a live status region — but it deliberately cannot
 * send anything, because LYNQ must never contact a prospect's customers on
 * its behalf and must never imply that it has. The notice is rendered
 * before any interaction and repeated on submit, and the validator refuses
 * a site whose rendered page does not carry it.
 *
 * The component is deliberately hook-free and its element ids are derived
 * from the specification. That keeps every id stable and predictable, and
 * it lets the deterministic validator render this exact component tree
 * without a React server runtime — see `website/render.ts`.
 */
export function DemoLeadForm({ form, idPrefix, locale }: { form: FormSpec; idPrefix: string; locale: "en" | "ar" }) {
  const statusId = `${idPrefix}-status`;
  const requiredHint = locale === "ar" ? "مطلوب" : "required";

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const status = event.currentTarget.ownerDocument.getElementById(statusId);
        if (status) status.textContent = form.demoNotice;
      }}
      className="grid gap-[var(--demo-gap)]"
    >
      <p className="text-sm leading-7 text-[var(--demo-muted)]">{form.introduction}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {form.fields.map((field) => {
          const fieldId = `${idPrefix}-${field.name}`;
          const helpId = field.help ? `${fieldId}-help` : undefined;
          const shared = {
            id: fieldId,
            name: field.name,
            required: field.required,
            "aria-describedby": helpId,
            autoComplete: field.autoComplete ?? undefined,
            className:
              "min-h-12 w-full rounded-[var(--demo-radius)] border border-[color-mix(in_srgb,var(--demo-ink)_22%,transparent)] bg-[var(--demo-bg)] px-4 py-3 text-base text-[var(--demo-ink)] outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--demo-accent)]",
          };
          return (
            <p key={field.name} className={field.type === "textarea" ? "grid gap-2 sm:col-span-2" : "grid gap-2"}>
              <label htmlFor={fieldId} className="text-xs uppercase tracking-[0.16em] text-[var(--demo-muted)]">
                {field.label}
                {field.required ? <span className="ms-1 text-[var(--demo-accent)]">({requiredHint})</span> : null}
              </label>
              {field.type === "textarea" ? (
                <textarea {...shared} rows={5} />
              ) : field.type === "select" ? (
                <select {...shared}>
                  {(field.options ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input {...shared} type={field.type} />
              )}
              {field.help ? (
                <span id={helpId} className="text-xs text-[var(--demo-muted)]">
                  {field.help}
                </span>
              ) : null}
            </p>
          );
        })}
      </div>
      <p className="text-xs leading-6 text-[var(--demo-muted)]">{form.demoNotice}</p>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          className="inline-flex min-h-12 items-center rounded-[var(--demo-radius)] bg-[var(--demo-accent)] px-7 text-sm font-semibold text-[var(--demo-accent-ink)] outline-offset-2 transition focus-visible:outline-2 focus-visible:outline-[var(--demo-ink)]"
        >
          {form.submitLabel}
        </button>
        <p id={statusId} role="status" aria-live="polite" className="text-sm text-[var(--demo-muted)]" />
      </div>
    </form>
  );
}
