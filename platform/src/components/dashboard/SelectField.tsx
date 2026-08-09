/**
 * A labeled `<select>` with an accessible name — used for role pickers
 * (Step 5B: "role selectors have accessible names"). Uncontrolled by
 * default (`value`/`onChange` optional) so it can be used both as a plain
 * form field and as a controlled input when a parent needs to react to
 * the selection (e.g. to show a "save this change" confirmation).
 */
export function SelectField({
  label,
  name,
  options,
  value,
  defaultValue,
  onChange,
  disabled,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="sr-only">{label}</span>
      <select
        name={name}
        aria-label={label}
        value={value}
        defaultValue={defaultValue}
        disabled={disabled}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        className="lynq-transition min-h-11 rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground hover:border-border-strong focus-visible:border-accent/60 disabled:opacity-50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
