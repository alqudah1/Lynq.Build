import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { ProjectStatusControl } from "./ProjectStatusControl";
import type { ActionResult } from "@/lib/dashboard/actions/types";

describe("ProjectStatusControl", () => {
  it("offers only the server-computed legal next statuses, with no axe violations", async () => {
    const action = vi.fn(async () => ({ ok: true }) as ActionResult);
    const { container } = render(<ProjectStatusControl currentStatus="proposed" legalTargets={["planning", "cancelled"]} expectedRevision={1} action={action} />);

    const select = screen.getByRole("combobox", { name: "Move to" });
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Planning", "Cancelled"]);
    expect(select).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows a plain, controlless status readout once no further transition is legal (never a hidden/disabled control)", async () => {
    const action = vi.fn(async () => ({ ok: true }) as ActionResult);
    const { container } = render(<ProjectStatusControl currentStatus="archived" legalTargets={[]} expectedRevision={1} action={action} />);

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText(/no further transitions available/i)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
