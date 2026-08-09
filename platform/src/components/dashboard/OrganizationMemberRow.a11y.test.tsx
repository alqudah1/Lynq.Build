import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { OrganizationMemberRow } from "./OrganizationMemberRow";
import type { ActionResult } from "@/lib/dashboard/actions/types";

function renderRow(overrides: Partial<Parameters<typeof OrganizationMemberRow>[0]> = {}) {
  const changeRoleAction = vi.fn(async () => ({ ok: true }) as ActionResult);
  const removeAction = vi.fn(async () => ({ ok: true }) as ActionResult);
  const utils = render(
    <table>
      <tbody>
        <OrganizationMemberRow
          name="Jane Doe"
          email="jane@example.com"
          role="member"
          canManage
          isSelf={false}
          changeRoleAction={changeRoleAction}
          removeAction={removeAction}
          {...overrides}
        />
      </tbody>
    </table>
  );
  return { ...utils, changeRoleAction, removeAction };
}

describe("OrganizationMemberRow", () => {
  it("gives the role selector a per-row accessible name and has no axe violations", async () => {
    const { container } = renderRow();
    expect(screen.getByRole("combobox", { name: "Role for Jane Doe" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("hides management controls entirely for a row the caller cannot manage", () => {
    renderRow({ canManage: false });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
    expect(screen.getByText("member")).toBeInTheDocument();
  });

  it("shows 'This is you' instead of any mutation control for the current user's own row", () => {
    renderRow({ isSelf: true });
    expect(screen.getByText("This is you")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
  });

  it("only reveals 'Save role' once a different role is actually selected, and confirming calls the bound action", async () => {
    const { removeAction, changeRoleAction } = renderRow();
    expect(screen.queryByRole("button", { name: "Save role" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Role for Jane Doe" }), { target: { value: "admin" } });
    const saveTrigger = screen.getByRole("button", { name: "Save role" });
    fireEvent.click(saveTrigger);

    const dialog = screen.getByRole("dialog", { name: "Change role" });
    expect(dialog).toHaveAccessibleDescription(/change jane doe's role from member to admin/i);

    fireEvent.click(screen.getByRole("button", { name: "Change role" }));
    await waitFor(() => expect(changeRoleAction).toHaveBeenCalledTimes(1));
    expect(removeAction).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation before removing a member", async () => {
    const { removeAction } = renderRow();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    const dialog = screen.getByRole("dialog", { name: "Remove member" });
    expect(dialog).toHaveAccessibleDescription(/remove jane doe from this organization/i);
    expect(removeAction).not.toHaveBeenCalled();

    const confirmButton = screen.getAllByRole("button", { name: "Remove" })[1];
    fireEvent.click(confirmButton);
    await waitFor(() => expect(removeAction).toHaveBeenCalledTimes(1));
  });
});
