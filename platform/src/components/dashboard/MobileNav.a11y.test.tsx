import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import type { ReactNode } from "react";
import { MobileNav } from "./MobileNav";
import { getNavItems } from "@/lib/dashboard/nav-items";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/acme",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const BASE_PROPS = {
  user: { name: "Ada Lovelace", email: "ada@example.com" },
  organizations: [{ slug: "acme", name: "Acme", role: "owner" }],
  currentOrganizationSlug: "acme",
  workspaces: [{ slug: "marketing", name: "Marketing", role: "manager" }],
  navItems: getNavItems("acme"),
  dashboardHref: "/app/acme",
};

describe("MobileNav", () => {
  it("is closed initially and every touch target meets the 44px minimum via min-h-11/min-w-11", () => {
    render(<MobileNav {...BASE_PROPS} />);
    const trigger = screen.getByRole("button", { name: /open navigation menu/i });
    expect(trigger.className).toMatch(/min-h-11/);
    expect(trigger.className).toMatch(/min-w-11/);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens as an accessible dialog, moves focus to the close button, and has no axe violations", async () => {
    const { container } = render(<MobileNav {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: /open navigation menu/i }));

    const dialog = screen.getByRole("dialog", { name: /navigation/i });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.className).toMatch(/bg-\[#0b0b0c\]/);
    expect(dialog.className).not.toMatch(/lynq-glass-strong/);

    await waitFor(() => expect(screen.getByRole("button", { name: /close navigation menu/i })).toHaveFocus());

    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows the same information hierarchy as the desktop sidebar: organization, workspace, nav, account", () => {
    render(<MobileNav {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: /open navigation menu/i }));

    expect(screen.getByText("Organization")).toBeInTheDocument();
    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /primary/i })).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("only shows usable navigation routes", () => {
    render(<MobileNav {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: /open navigation menu/i }));

    expect(screen.queryByText("Coming later")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My Work" })).toHaveAttribute("href", "/app/acme/my-work");
    expect(screen.getByRole("link", { name: "Workflow Executions" })).toHaveAttribute("href", "/app/acme/workflow-executions");
  });

  it("closes on Escape and returns focus to the trigger button", async () => {
    render(<MobileNav {...BASE_PROPS} />);
    const trigger = screen.getByRole("button", { name: /open navigation menu/i });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
