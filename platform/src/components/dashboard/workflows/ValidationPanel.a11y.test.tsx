import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { ValidationPanel } from "./ValidationPanel";
import type { ActionResult } from "@/lib/dashboard/actions/types";

describe("ValidationPanel", () => {
  it("shows a not-yet-validated state with no axe violations", async () => {
    const action = vi.fn(async () => ({ ok: true }) as ActionResult & { validation?: unknown });
    const { container } = render(<ValidationPanel lastResult={null} action={action} />);

    expect(screen.getByText(/not yet validated/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run validation/i })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("renders structured issues as an accessible alert region, one per line, referencing the node key", async () => {
    const action = vi.fn(async () => ({ ok: true, validation: { valid: false, issues: [{ nodeKey: "cond", message: "invalid configuration: bad shape" }, { message: "the workflow must have at least one end node" }] } }) as ActionResult & { validation?: unknown });
    render(<ValidationPanel lastResult={null} action={action} />);

    fireEvent.click(screen.getByRole("button", { name: /run validation/i }));

    const alert = await screen.findByRole("alert");
    expect(action).toHaveBeenCalledTimes(1);
    expect(alert).toHaveTextContent(/cond.*invalid configuration/i);
    expect(alert).toHaveTextContent(/at least one end node/i);
  });

  it("shows a valid, ready-to-publish status message via a polite live region", async () => {
    const action = vi.fn(async () => ({ ok: true, validation: { valid: true, issues: [] } }) as ActionResult & { validation?: unknown });
    render(<ValidationPanel lastResult={null} action={action} />);

    fireEvent.click(screen.getByRole("button", { name: /run validation/i }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/ready to publish/i);
  });
});
