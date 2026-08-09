import Link from "next/link";

export interface Breadcrumb {
  label: string;
  href?: string;
}

/** `<nav aria-label="Breadcrumb">` with an ordered list — the standard accessible breadcrumb pattern; the final (current-page) item is never a link. */
export function Breadcrumbs({ items }: { items: Breadcrumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.1em] text-subtle">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex items-center gap-2">
            {index > 0 ? <span aria-hidden="true" className="text-subtle/60">/</span> : null}
            {item.href ? (
              <Link href={item.href} className="lynq-transition hover:text-foreground">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-foreground">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
