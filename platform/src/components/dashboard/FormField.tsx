/**
 * A labeled text input with inline, field-associated error display (Step
 * 5B accessibility requirement: "every input has a label," "errors are
 * associated with fields"). `aria-describedby`/`aria-invalid` are set
 * automatically whenever `error` is present — never a floating error
 * message disconnected from its input.
 */
export function FormField({
  label,
  name,
  type = "text",
  defaultValue,
  error,
  required,
  autoComplete,
  placeholder,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  error?: string[];
  required?: boolean;
  autoComplete?: string;
  placeholder?: string;
  hint?: string;
}) {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;
  const hasError = Boolean(error && error.length > 0);
  const describedBy = [hasError ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-xs uppercase tracking-[0.1em] text-subtle">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy}
        className={`lynq-transition min-h-11 rounded-sm border bg-elevated px-3 py-2 text-sm text-foreground placeholder:text-subtle hover:border-border-strong focus-visible:border-accent/60 ${hasError ? "border-danger/50" : "border-border"}`}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-subtle">
          {hint}
        </p>
      ) : null}
      {hasError ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error![0]}
        </p>
      ) : null}
    </div>
  );
}
