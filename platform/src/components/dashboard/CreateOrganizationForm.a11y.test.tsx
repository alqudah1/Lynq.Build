import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { CreateOrganizationForm } from "./CreateOrganizationForm";

vi.mock("@/lib/dashboard/actions/organizations", () => ({
  createOrganizationAction: vi.fn(async () => ({ ok: true })),
}));

describe("CreateOrganizationForm", () => {
  it("labels every field and exposes a working submit button, with no axe violations", async () => {
    const { container } = render(<CreateOrganizationForm />);

    expect(screen.getByLabelText(/organization name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^slug/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create organization/i })).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });

  it("marks the name and slug fields as required", () => {
    render(<CreateOrganizationForm />);
    expect(screen.getByLabelText(/organization name/i)).toBeRequired();
    expect(screen.getByLabelText(/^slug/i)).toBeRequired();
  });
});
