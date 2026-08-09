import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import type { ReactNode } from "react";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

let mockPathname = "/app/acme/marketing";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

const WORKSPACES = [
  { slug: "marketing", name: "Marketing", role: "manager" },
  { slug: "sales", name: "Sales", role: "member" },
];

describe("WorkspaceSwitcher", () => {
  it("derives the current workspace from the URL and marks it with aria-current", async () => {
    mockPathname = "/app/acme/marketing";
    const { container } = render(<WorkspaceSwitcher organizationSlug="acme" workspaces={WORKSPACES} />);

    expect(screen.getByRole("button")).toHaveTextContent("Marketing");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("menuitem", { name: /Marketing/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("menuitem", { name: /Sales/ })).not.toHaveAttribute("aria-current");

    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows an explicit empty state when no workspace is assigned in this organization", () => {
    mockPathname = "/app/acme";
    render(<WorkspaceSwitcher organizationSlug="acme" workspaces={[]} />);
    expect(screen.getByText(/No workspaces assigned/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("closes on Escape", () => {
    mockPathname = "/app/acme/marketing";
    render(<WorkspaceSwitcher organizationSlug="acme" workspaces={WORKSPACES} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
