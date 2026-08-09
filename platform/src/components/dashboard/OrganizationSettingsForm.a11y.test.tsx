import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { OrganizationSettingsForm } from "./OrganizationSettingsForm";
import { updateOrganizationAction } from "@/lib/dashboard/actions/organizations";

vi.mock("@/lib/dashboard/actions/organizations", () => ({
  updateOrganizationAction: vi.fn(),
}));

describe("OrganizationSettingsForm", () => {
  it("pre-fills name/slug, labels every field, and has no axe violations", async () => {
    const { container } = render(<OrganizationSettingsForm organizationSlug="acme" name="Acme Inc" slug="acme" />);

    expect(screen.getByLabelText(/organization name/i)).toHaveValue("Acme Inc");
    expect(screen.getByLabelText(/^slug/i)).toHaveValue("acme");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("associates a field-level validation error with its input via aria-describedby, in an alert live region", async () => {
    vi.mocked(updateOrganizationAction).mockResolvedValue({
      ok: false,
      code: "invalid_request",
      message: "Please fix the errors below.",
      fieldErrors: { slug: ["This slug is reserved and can't be used."] },
    });
    render(<OrganizationSettingsForm organizationSlug="acme" name="Acme Inc" slug="acme" />);

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(screen.getByText("This slug is reserved and can't be used.")).toBeInTheDocument());
    const fieldError = screen.getByText("This slug is reserved and can't be used.");
    expect(fieldError).toHaveAttribute("role", "alert");
    const slugInput = screen.getByLabelText(/^slug/i);
    expect(slugInput).toHaveAttribute("aria-invalid", "true");
    expect(slugInput.getAttribute("aria-describedby")).toContain(fieldError.id);
  });

  it("announces a successful save via a polite status live region", async () => {
    vi.mocked(updateOrganizationAction).mockResolvedValue({ ok: true });
    render(<OrganizationSettingsForm organizationSlug="acme" name="Acme Inc" slug="acme" />);

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Changes saved."));
  });
});
