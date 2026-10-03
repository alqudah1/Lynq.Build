"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

/**
 * Brand switcher for every Social page — the selection lives in the URL
 * (`?brand=<brandProfileId>`) so it is shareable, survives refresh, and the
 * server components read it directly. Changing brand resets paging-like
 * params that belong to a different brand's data (none today) but keeps
 * view filters such as `?view=` / `?from=`.
 */
export function SocialBrandSwitcher({
  brands,
  selectedBrandId,
  allowAll = true,
}: {
  brands: { id: string; name: string }[];
  selectedBrandId: string | null;
  allowAll?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  if (brands.length === 0) return null;

  function onChange(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set("brand", value);
    else next.set("brand", "all");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  }

  return (
    <label className="flex items-center gap-2">
      <span className="text-xs uppercase tracking-[0.1em] text-subtle">Brand</span>
      <select
        aria-label="Brand"
        value={selectedBrandId ?? ""}
        onChange={(event) => onChange(event.target.value)}
        disabled={pending}
        className="lynq-transition min-h-11 rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground hover:border-border-strong focus-visible:border-accent/60 disabled:opacity-60"
      >
        {allowAll ? <option value="">All brands</option> : null}
        {brands.map((brand) => (
          <option key={brand.id} value={brand.id}>
            {brand.name}
          </option>
        ))}
      </select>
    </label>
  );
}
