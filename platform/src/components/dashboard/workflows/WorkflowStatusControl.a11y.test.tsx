import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { WorkflowStatusControl } from "./WorkflowStatusControl";
import type { ActionResult } from "@/lib/dashboard/actions/types";

describe("WorkflowStatusControl", () => {
  it("offers only the server-computed legal next statuses, with no axe violations", async () => {
    const action = vi.fn(async () => ({ ok: true }) as ActionResult);
    const { container } = render(<WorkflowStatusControl currentStatus="published" legalTargets={["paused", "archived"]} expectedRevision={1} action={action} />);

    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Paused", "Archived"]);
    expect(screen.getByRole("combobox", { name: "Move to" })).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows a plain, controlless status readout once no further transition is legal", async () => {
    const action = vi.fn(async () => ({ ok: true }) as ActionResult);
    const { container } = render(<WorkflowStatusControl currentStatus="archived" legalTargets={[]} expectedRevision={1} action={action} />);

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText(/no further transitions available/i)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
