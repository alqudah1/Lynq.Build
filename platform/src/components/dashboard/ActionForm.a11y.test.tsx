import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { ActionForm } from "./ActionForm";
import type { ActionResult } from "@/lib/dashboard/actions/types";

describe("ActionForm", () => {
  it("renders its children and hidden fields with no axe violations", async () => {
    const action = vi.fn(async () => ({ ok: true }) as ActionResult);
    const { container } = render(
      <ActionForm action={action} hiddenFields={{ expectedRevision: 3 }}>
        <button type="submit">Save</button>
      </ActionForm>
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("submits the action with the hidden fields included, and shows no error message on success", async () => {
    const action = vi.fn<(formData: FormData) => Promise<ActionResult>>(async () => ({ ok: true }));
    render(
      <ActionForm action={action} hiddenFields={{ leadId: "abc-123" }}>
        <button type="submit">Save</button>
      </ActionForm>
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const submittedFormData = action.mock.calls[0][0];
    expect(submittedFormData.get("leadId")).toBe("abc-123");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces a failed action's message in an accessible alert region, with no axe violations", async () => {
    const action = vi.fn(async () => ({ ok: false, code: "invalid_request", message: "Something went wrong." }) as ActionResult);
    const { container } = render(
      <ActionForm action={action}>
        <button type="submit">Save</button>
      </ActionForm>
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong.");
    expect(await axe(container)).toHaveNoViolations();
  });
});
