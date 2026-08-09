/**
 * A restrained loading placeholder — a static, low-contrast block, not a
 * shimmering animation (kept intentionally quiet, and automatically
 * inert under `prefers-reduced-motion` via the shared `.lynq-transition`
 * discipline). Used for structural loading states only — never rendered
 * with a fabricated number or label pretending to be real data.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-sm bg-white/[0.06] ${className}`} />;
}
