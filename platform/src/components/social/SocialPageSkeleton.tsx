import { Skeleton } from "@/components/ui/Skeleton";

/** Route-level loading state for Social pages — the same container as the page, structural blocks only (no fake numbers). */
export function SocialPageSkeleton({ variant = "list" }: { variant?: "list" | "grid" | "split" | "cards" }) {
  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-3 w-48" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      {variant === "grid" ? (
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 35 }, (_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : variant === "split" ? (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <Skeleton className="h-64" />
          <Skeleton className="h-96" />
        </div>
      ) : variant === "cards" ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-80" />)}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-20" />)}
          </div>
          {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-14" />)}
        </div>
      )}
    </div>
  );
}
