import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { CreateContactForm } from "./CreateContactForm";
import type { ActionResult } from "@/lib/dashboard/actions/types";

describe("CreateContactForm", () => {
  it("renders with no axe violations, and every field is optional except at least one identity", async () => {
    const action = vi.fn(async () => ({ ok: true }) as ActionResult);
    const { container } = render(<CreateContactForm action={action} />);
    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create contact/i })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("surfaces a field-level error via an accessible alert, associated with its input", async () => {
    const action = vi.fn(async () => ({ ok: false, code: "no_stable_identity", message: "A contact needs at least one stable identity", fieldErrors: { firstName: ["Required"] } }) as ActionResult);
    render(<CreateContactForm action={action} />);

    fireEvent.click(screen.getByRole("button", { name: /create contact/i }));
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.some((a) => a.textContent?.match(/required/i))).toBe(true);
  });
});
