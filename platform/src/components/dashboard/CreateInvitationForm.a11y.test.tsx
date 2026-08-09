import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { CreateInvitationForm } from "./CreateInvitationForm";

vi.mock("@/lib/dashboard/actions/invitations", () => ({
  createOrRefreshInvitationAction: vi.fn(async () => ({ ok: true, refreshed: false })),
}));

const AVAILABLE_ROLES = [
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
];
const WORKSPACES = [{ id: "ws-1", name: "Marketing" }];

describe("CreateInvitationForm", () => {
  it("labels every field, offers only the actor's available roles, and has no axe violations", async () => {
    const { container } = render(
      <CreateInvitationForm organizationSlug="acme" availableRoles={AVAILABLE_ROLES} workspaces={WORKSPACES} />
    );

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /organization role/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Owner" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send invitation/i })).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });

  it("marks the email field as required", () => {
    render(<CreateInvitationForm organizationSlug="acme" availableRoles={AVAILABLE_ROLES} workspaces={WORKSPACES} />);
    expect(screen.getByLabelText(/email/i)).toBeRequired();
  });

  it("only shows a workspace-role selector once a workspace has actually been chosen", () => {
    render(<CreateInvitationForm organizationSlug="acme" availableRoles={AVAILABLE_ROLES} workspaces={WORKSPACES} />);

    expect(screen.queryByRole("combobox", { name: /workspace role/i })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: /workspace \(optional\)/i }), { target: { value: "ws-1" } });

    expect(screen.getByRole("combobox", { name: /workspace role/i })).toBeInTheDocument();
  });

  it("omits the workspace picker entirely when the organization has no workspaces", () => {
    render(<CreateInvitationForm organizationSlug="acme" availableRoles={AVAILABLE_ROLES} workspaces={[]} />);
    expect(screen.queryByRole("combobox", { name: /workspace/i })).not.toBeInTheDocument();
  });
});
