import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { ExecutionControls } from "./ExecutionControls";
import type { ActionResult } from "@/lib/dashboard/actions/types";

function actions() {
  return {
    pauseAction: vi.fn(async () => ({ ok: true }) as ActionResult),
    resumeAction: vi.fn(async () => ({ ok: true }) as ActionResult),
    cancelAction: vi.fn(async () => ({ ok: true }) as ActionResult),
    retryAction: vi.fn(async () => ({ ok: true }) as ActionResult),
  };
}

describe("ExecutionControls", () => {
  it("shows pause and cancel for a running execution, with no axe violations", async () => {
    const { container } = render(<ExecutionControls status="running" expectedRevision={1} canManage {...actions()} />);
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows only resume and cancel for a paused execution", () => {
    render(<ExecutionControls status="paused" expectedRevision={1} canManage {...actions()} />);
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
  });

  it("shows retry for a failed execution and no controls at all for a completed one", () => {
    const { rerender } = render(<ExecutionControls status="failed" expectedRevision={1} canManage {...actions()} />);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();

    rerender(<ExecutionControls status="completed" expectedRevision={1} canManage {...actions()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders nothing at all when the caller cannot manage this execution", () => {
    const { container } = render(<ExecutionControls status="running" expectedRevision={1} canManage={false} {...actions()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
