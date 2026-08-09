import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import type { ReactNode } from "react";
import { OrganizationSwitcher } from "./OrganizationSwitcher";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const ORGANIZATIONS = [
  { slug: "acme", name: "Acme", role: "owner" },
  { slug: "beta-co", name: "Beta Co", role: "member" },
];

describe("OrganizationSwitcher", () => {
  it("shows only the organizations it was given, with the current one on the trigger", () => {
    render(<OrganizationSwitcher organizations={ORGANIZATIONS} currentSlug="acme" />);
    expect(screen.getByRole("button")).toHaveTextContent("Acme");
  });

  it("opens the menu, marks the current organization with aria-current, and has no axe violations", async () => {
    const { container } = render(<OrganizationSwitcher organizations={ORGANIZATIONS} currentSlug="acme" />);
    fireEvent.click(screen.getByRole("button"));

    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(3); // 2 organizations + "New organization"
    expect(screen.getByRole("menuitem", { name: /Acme/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("menuitem", { name: /Beta Co/ })).not.toHaveAttribute("aria-current");

    expect(await axe(container)).toHaveNoViolations();
  });

  it("closes on Escape", () => {
    render(<OrganizationSwitcher organizations={ORGANIZATIONS} currentSlug="acme" />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("shows an explicit empty state when the user belongs to no organization", () => {
    render(<OrganizationSwitcher organizations={[]} currentSlug={null} />);
    expect(screen.getByText(/No organizations yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
