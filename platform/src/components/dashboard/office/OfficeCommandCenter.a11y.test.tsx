import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { OfficeCommandCenter } from "./OfficeCommandCenter";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("OfficeCommandCenter accessibility", () => {
  it("labels the founder command composer and has no axe violations", async () => {
    const { container } = render(
      <OfficeCommandCenter
        organizationId="organization-1"
        organizationSlug="lynq"
        navigateToDirective
      />,
    );

    expect(screen.getByRole("heading", { name: "What should Jarvis coordinate?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Founder directive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send to jarvis/i })).toBeDisabled();
    expect(await axe(container)).toHaveNoViolations();
  });
});
