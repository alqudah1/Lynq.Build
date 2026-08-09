/** A compact, restrained progress indicator — a real percentage only, never a fabricated one; `percentage: null` renders as an honest "No tasks yet" label rather than a fake 0% bar. */
export function ProgressBar({ percentage, label }: { percentage: number | null; label?: string }) {
  if (percentage === null) {
    return <span className="text-xs text-subtle">{label ?? "No tasks yet"}</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-white/[0.08]" role="progressbar" aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}>
        <div className="lynq-transition h-full rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, percentage))}%` }} />
      </div>
      <span className="text-xs text-subtle">{percentage}%</span>
    </div>
  );
}
