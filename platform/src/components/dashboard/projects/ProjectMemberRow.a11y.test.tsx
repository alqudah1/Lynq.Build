import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { ProjectMemberRow } from "./ProjectMemberRow";
import type { ActionResult } from "@/lib/dashboard/actions/types";

function renderRow(overrides: Partial<Parameters<typeof ProjectMemberRow>[0]> = {}) {
  const changeRoleAction = vi.fn(async () => ({ ok: true }) as ActionResult);
  const removeAction = vi.fn(async () => ({ ok: true }) as ActionResult);
  const utils = render(
    <table>
      <tbody>
        <tr>
          <ProjectMemberRow name="Jane Doe" email="jane@example.com" role="contributor" canManage changeRoleAction={changeRoleAction} removeAction={removeAction} {...overrides} />
        </tr>
      </tbody>
    </table>
  );
  return { ...utils, changeRoleAction, removeAction };
}

describe("ProjectMemberRow", () => {
  it("gives the role selector a per-row accessible name and has no axe violations", async () => {
    const { container } = renderRow();
    expect(screen.getByRole("combobox", { name: "Role for Jane Doe" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("hides management controls entirely when the caller cannot manage this project", () => {
    renderRow({ canManage: false });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
    expect(screen.getByText("contributor")).toBeInTheDocument();
  });

  it("only reveals 'Save role' once a different role is actually selected, and confirming calls the bound action", async () => {
    const { changeRoleAction, removeAction } = renderRow();
    expect(screen.queryByRole("button", { name: "Save role" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Role for Jane Doe" }), { target: { value: "project_manager" } });
    fireEvent.click(screen.getByRole("button", { name: "Save role" }));

    const dialog = screen.getByRole("dialog", { name: "Change role" });
    expect(dialog).toHaveAccessibleDescription(/change jane doe's role from contributor to project_manager/i);

    fireEvent.click(screen.getByRole("button", { name: "Change role" }));
    await waitFor(() => expect(changeRoleAction).toHaveBeenCalledTimes(1));
    expect(removeAction).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation before removing a project member", async () => {
    const { removeAction } = renderRow();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    const dialog = screen.getByRole("dialog", { name: "Remove member" });
    expect(dialog).toHaveAccessibleDescription(/remove jane doe from this project/i);
    expect(removeAction).not.toHaveBeenCalled();

    const confirmButton = screen.getAllByRole("button", { name: "Remove" })[1];
    fireEvent.click(confirmButton);
    await waitFor(() => expect(removeAction).toHaveBeenCalledTimes(1));
  });
});
