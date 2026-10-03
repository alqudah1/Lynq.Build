/**
 * Resolves the `?brand=` query param against the organization's brands.
 * Absent/unknown → the first brand (the default working context);
 * `all` → no brand filter (only where the page's services accept that).
 */
export function resolveBrandSelection(brands: { id: string; name: string }[], raw: string | string[] | undefined, allowAll: boolean): { selectedBrandId: string | null; brandProfileId: string | undefined; brandName: string | null; brandParam: string | undefined } {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === "all" && allowAll) return { selectedBrandId: null, brandProfileId: undefined, brandName: null, brandParam: "all" };
  const match = value ? brands.find((b) => b.id === value) : undefined;
  const chosen = match ?? brands[0];
  if (!chosen) return { selectedBrandId: null, brandProfileId: undefined, brandName: null, brandParam: undefined };
  return { selectedBrandId: chosen.id, brandProfileId: chosen.id, brandName: chosen.name, brandParam: match ? match.id : undefined };
}

export function firstParam(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}
