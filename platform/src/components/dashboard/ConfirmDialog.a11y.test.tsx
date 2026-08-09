import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { ConfirmDialog } from "./ConfirmDialog";
import type { ActionResult } from "@/lib/dashboard/actions/types";

function setup(formAction: (formData: FormData) => Promise<ActionResult>) {
  return render(
    <ConfirmDialog
      triggerLabel="Remove"
      triggerVariant="danger"
      variant="danger"
      title="Remove member"
      description="Remove Jane Doe from this organization? They will lose access immediately."
      confirmLabel="Remove"
      formAction={formAction}
    />
  );
}

describe("ConfirmDialog", () => {
  it("does not run the mutation just from clicking the trigger — only opens the dialog", () => {
    const formAction = vi.fn(async () => ({ ok: true }) as ActionResult);
    setup(formAction);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(formAction).not.toHaveBeenCalled();
  });

  it("opens as an accessible, labelled dialog and moves focus to the Cancel button, with no axe violations", async () => {
    const formAction = vi.fn(async () => ({ ok: true }) as ActionResult);
    const { container } = setup(formAction);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = screen.getByRole("dialog", { name: /remove member/i });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(/remove jane doe/i);

    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
    expect(await axe(container)).toHaveNoViolations();
  });

  it("closes on Escape and returns focus to the trigger, without ever calling the action", () => {
    const formAction = vi.fn(async () => ({ ok: true }) as ActionResult);
    setup(formAction);

    const trigger = screen.getByRole("button", { name: "Remove" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(formAction).not.toHaveBeenCalled();
  });

  it("only calls the bound action when Confirm inside the dialog is submitted, and closes on success", async () => {
    const formAction = vi.fn(async () => ({ ok: true }) as ActionResult);
    setup(formAction);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const confirmButton = screen.getAllByRole("button", { name: "Remove" })[1];
    fireEvent.click(confirmButton);

    await waitFor(() => expect(formAction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows the error inline and keeps the dialog open when the action fails", async () => {
    const formAction = vi.fn(async () => ({ ok: false, code: "forbidden", message: "You don't have permission to do this." }) as ActionResult);
    const { container } = setup(formAction);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = screen.getByRole("dialog");
    const confirmButton = screen.getAllByRole("button", { name: "Remove" })[1];
    fireEvent.click(confirmButton);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("You don't have permission to do this.");
    expect(dialog).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
