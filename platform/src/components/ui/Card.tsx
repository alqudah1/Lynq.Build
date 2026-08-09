import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

type CardOwnProps<T extends ElementType> = {
  children: ReactNode;
  as?: T;
  /**
   * "glass" — subtly translucent, blurred (sidebar/top bar/primary content cards/dialogs).
   * "surface" — solid elevated (dense tables, long-form content that must stay fully legible).
   * "flat" — no fill at all, border only (nested/secondary groupings inside another card).
   */
  variant?: "glass" | "surface" | "flat";
  /** Lifts the card on hover — only for genuinely interactive/clickable cards, never decorative ones. */
  interactive?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
  className?: string;
};

export type CardProps<T extends ElementType = "div"> = CardOwnProps<T> & Omit<ComponentPropsWithoutRef<T>, keyof CardOwnProps<T>>;

const PADDING = { none: "", sm: "p-4", md: "p-6", lg: "p-8" } as const;
const VARIANT = {
  glass: "lynq-glass rounded-md",
  surface: "lynq-surface rounded-md",
  flat: "rounded-md border border-border",
} as const;

/**
 * The one shared card/panel primitive — glass by default, matching the
 * refinement pass's own "reusable components rather than page-specific
 * duplicated styles" instruction. `interactive` adds a restrained
 * hover-lift + border brightening, never a heavy shadow or scale-jump.
 * Polymorphic (`as`) so it can render as a `<Link>`/`<button>`/etc. and
 * still forward that element's own real props (e.g. `href`, `onClick`)
 * — never a lookalike that silently drops them.
 */
export function Card<T extends ElementType = "div">({ children, as, variant = "glass", interactive = false, padding = "md", className = "", ...rest }: CardProps<T>) {
  const Tag = (as ?? "div") as ElementType;
  return (
    <Tag
      className={`lynq-transition ${VARIANT[variant]} ${PADDING[padding]} ${interactive ? "hover:border-border-strong hover:-translate-y-[1px] hover:shadow-sm" : ""} ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}
