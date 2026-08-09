import type { ReactNode } from "react";

/**
 * The shared page-header block — eyebrow label, serif title, optional
 * description, optional trailing actions. Used at the top of every
 * refreshed list/detail page instead of a page-specific ad hoc header,
 * so heading hierarchy and spacing stay consistent everywhere.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        {eyebrow ? <p className="text-xs uppercase tracking-[0.25em] text-subtle">{eyebrow}</p> : null}
        <h1 className="font-serif text-3xl italic font-light text-foreground">{title}</h1>
        {description ? <p className="max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}
