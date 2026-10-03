/**
 * Labeled form controls for Social forms (textarea / select / datetime) that
 * match `FormField`'s visual language — `FormField` itself only renders a
 * single-line input. Hook-free so server components can render them inside
 * client `ActionForm`s.
 */

const CONTROL = "lynq-transition w-full rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground placeholder:text-subtle hover:border-border-strong focus-visible:border-accent/60 disabled:opacity-60";
const LABEL = "text-xs uppercase tracking-[0.1em] text-subtle";

export function TextAreaField({ label, name, defaultValue, rows = 3, maxLength, placeholder, hint, required, id }: { label: string; name: string; defaultValue?: string; rows?: number; maxLength?: number; placeholder?: string; hint?: string; required?: boolean; id?: string }) {
  const fieldId = id ?? `field-${name}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className={LABEL}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <textarea id={fieldId} name={name} defaultValue={defaultValue} rows={rows} maxLength={maxLength} placeholder={placeholder} required={required} aria-describedby={hint ? `${fieldId}-hint` : undefined} className={`${CONTROL} min-h-20`} />
      {hint ? <p id={`${fieldId}-hint`} className="text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}

export function TextField({ label, name, defaultValue, maxLength, placeholder, hint, required, type = "text", id }: { label: string; name: string; defaultValue?: string; maxLength?: number; placeholder?: string; hint?: string; required?: boolean; type?: string; id?: string }) {
  const fieldId = id ?? `field-${name}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className={LABEL}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <input id={fieldId} name={name} type={type} defaultValue={defaultValue} maxLength={maxLength} placeholder={placeholder} required={required} aria-describedby={hint ? `${fieldId}-hint` : undefined} className={`${CONTROL} min-h-11`} />
      {hint ? <p id={`${fieldId}-hint`} className="text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}

export function LabeledSelect({ label, name, options, defaultValue, hint, id }: { label: string; name: string; options: { value: string; label: string }[]; defaultValue?: string; hint?: string; id?: string }) {
  const fieldId = id ?? `field-${name}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className={LABEL}>{label}</label>
      <select id={fieldId} name={name} defaultValue={defaultValue} aria-describedby={hint ? `${fieldId}-hint` : undefined} className={`${CONTROL} min-h-11`}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {hint ? <p id={`${fieldId}-hint`} className="text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}
