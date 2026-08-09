import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { AddWorkspaceMemberForm } from "./AddWorkspaceMemberForm";

vi.mock("@/lib/dashboard/actions/workspaces", () => ({
  addWorkspaceMemberAction: vi.fn(async () => ({ ok: true })),
}));

const CANDIDATES = [
  { name: "Jane Doe", email: "jane@example.com" },
  { name: null, email: "noname@example.com" },
];

describe("AddWorkspaceMemberForm", () => {
  it("lists candidates by name (or email when no name), keyed and valued by email, with no axe violations", async () => {
    const { container } = render(
      <AddWorkspaceMemberForm organizationSlug="acme" workspaceSlug="marketing" candidates={CANDIDATES} />
    );

    const select = screen.getByLabelText(/organization member/i);
    expect(select).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Jane Doe" })).toHaveValue("jane@example.com");
    expect(screen.getByRole("option", { name: "noname@example.com" })).toHaveValue("noname@example.com");

    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows an explicit empty state instead of an empty select when every org member already has access", () => {
    render(<AddWorkspaceMemberForm organizationSlug="acme" workspaceSlug="marketing" candidates={[]} />);
    expect(screen.getByText(/every organization member already has access/i)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("labels the workspace-role selector accessibly", () => {
    render(<AddWorkspaceMemberForm organizationSlug="acme" workspaceSlug="marketing" candidates={CANDIDATES} />);
    expect(screen.getByRole("combobox", { name: /workspace role/i })).toBeInTheDocument();
  });
});
