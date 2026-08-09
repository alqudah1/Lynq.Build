import type { ReactNode } from "react";

/**
 * Shared table primitives — consistent header/row/cell styling across
 * every list page instead of each page re-declaring its own `<table>`
 * classes. Always wrapped in its own `overflow-x-auto` container so a
 * wide table scrolls within itself and never forces the page to overflow
 * horizontally. Individual `<Td>`/`<Th>` cells may still be given
 * `hidden md:table-cell` by the caller to drop secondary columns on
 * narrow viewports — the lightest-weight way to keep a real data table
 * usable on mobile without a parallel stacked-card re-implementation of
 * every list.
 */
export function Table({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className={`w-full min-w-full text-left text-sm ${className}`}>{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-border bg-elevated">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border">{children}</tbody>;
}

export function Tr({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <tr className={`lynq-transition hover:bg-white/[0.02] ${className}`}>{children}</tr>;
}

export function Th({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <th scope="col" className={`px-4 py-3 text-xs font-medium uppercase tracking-[0.08em] text-subtle ${className}`}>{children}</th>;
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle text-foreground ${className}`}>{children}</td>;
}
