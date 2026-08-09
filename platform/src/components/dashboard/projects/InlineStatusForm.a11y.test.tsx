import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { InlineStatusForm } from "./InlineStatusForm";
import type { ActionResult } from "@/lib/dashboard/actions/types";

const OPTIONS = [
  { value: "backlog", label: "Backlog" },
  { value: "ready", label: "Ready" },
];

describe("InlineStatusForm", () => {
  it("labels the status selector accessibly and has no axe violations", async () => {
    const action = vi.fn(async () => ({ ok: true }) as ActionResult);
    const { container } = render(<InlineStatusForm label="Status for Task A" name="toStatus" currentValue="backlog" options={OPTIONS} expectedRevision={1} action={action} />);

    expect(screen.getByRole("combobox", { name: "Status for Task A" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("submits automatically on change, carrying the expected revision", async () => {
    const action = vi.fn<(formData: FormData) => Promise<ActionResult>>(async () => ({ ok: true }));
    render(<InlineStatusForm label="Status" name="toStatus" currentValue="backlog" options={OPTIONS} expectedRevision={7} action={action} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), { target: { value: "ready" } });
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const submittedFormData = action.mock.calls[0][0];
    expect(submittedFormData.get("toStatus")).toBe("ready");
    expect(submittedFormData.get("expectedRevision")).toBe("7");
  });

  it("surfaces a failed submission as an accessible alert rather than discarding it silently", async () => {
    const action = vi.fn(async () => ({ ok: false, code: "stale_update", message: "This task was modified by someone else" }) as ActionResult);
    render(<InlineStatusForm label="Status" name="toStatus" currentValue="backlog" options={OPTIONS} expectedRevision={1} action={action} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), { target: { value: "ready" } });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/modified by someone else/i);
  });
});
