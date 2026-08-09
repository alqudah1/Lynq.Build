import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { AddProjectMemberForm } from "./AddProjectMemberForm";
import type { ActionResult } from "@/lib/dashboard/actions/types";

const CANDIDATES = [
  { userId: "u1", name: "Jane Doe", email: "jane@example.com" },
  { userId: "u2", name: null, email: "noname@example.com" },
];

describe("AddProjectMemberForm", () => {
  it("lists candidates by name (or email when no name), and has no axe violations", async () => {
    const action = vi.fn(async () => ({ ok: true }) as ActionResult);
    const { container } = render(<AddProjectMemberForm candidates={CANDIDATES} action={action} />);

    expect(screen.getByRole("combobox", { name: "Add member" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Jane Doe" })).toHaveValue("u1");
    expect(screen.getByRole("option", { name: "noname@example.com" })).toHaveValue("u2");
    expect(screen.getByRole("combobox", { name: "Role" })).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows an explicit empty state instead of an empty select when every org member already belongs to the project", () => {
    const action = vi.fn(async () => ({ ok: true }) as ActionResult);
    render(<AddProjectMemberForm candidates={[]} action={action} />);
    expect(screen.getByText(/every organization member already belongs to this project/i)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
