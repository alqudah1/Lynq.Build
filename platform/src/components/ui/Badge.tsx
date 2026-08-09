import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const TONE: Record<BadgeTone, string> = {
  neutral: "border-border text-subtle",
  accent: "border-accent/30 bg-accent-wash text-accent-foreground",
  success: "border-success/30 bg-success-wash text-success",
  warning: "border-warning/30 bg-warning-wash text-warning",
  danger: "border-danger/30 bg-danger-wash text-danger",
  info: "border-info/30 bg-info-wash text-info",
};

/**
 * Compact status badge — status colors reserved for actual states (see
 * `tone`), never used as brand decoration. `dot` renders a small leading
 * indicator dot, useful for execution/pipeline status where a color-coded
 * dot reads faster than text alone (never color alone, though — the label
 * text is always present too, for colorblind/contrast accessibility).
 */
export function Badge({ children, tone = "neutral", dot = false, className = "" }: { children: ReactNode; tone?: BadgeTone; dot?: boolean; className?: string }) {
  return (
    <span className={`inline-flex min-h-6 items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-[0.08em] ${TONE[tone]} ${className}`}>
      {dot ? <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}
