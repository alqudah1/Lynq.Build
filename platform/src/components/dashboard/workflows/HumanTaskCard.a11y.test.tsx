import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { HumanTaskCard } from "./HumanTaskCard";
import type { WorkflowHumanTask } from "@/lib/workflows/human-tasks";
import type { ActionResult } from "@/lib/dashboard/actions/types";

const TASK: WorkflowHumanTask = {
  id: "task-1",
  organizationId: "org-1",
  workflowExecutionId: "exec-1",
  workflowNodeExecutionId: "node-exec-1",
  title: "Review the draft report",
  instructions: "Check for factual accuracy before approving.",
  assignedUserId: "user-1",
  dueDate: null,
  status: "pending",
  completedByUserId: null,
  completedAt: null,
  outputData: null,
  revision: 1,
  createdAt: new Date(),
};

describe("HumanTaskCard", () => {
  it("renders a labeled notes field and submit control, with no axe violations", async () => {
    const completeAction = vi.fn(async () => ({ ok: true }) as ActionResult);
    const { container } = render(
      <ul>
        <HumanTaskCard task={TASK} completeAction={completeAction} />
      </ul>
    );

    expect(screen.getByText("Review the draft report")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mark complete/i })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("submits the expected revision and calls the bound complete action", async () => {
    const completeAction = vi.fn<(formData: FormData) => Promise<ActionResult>>(async () => ({ ok: true }));
    render(
      <ul>
        <HumanTaskCard task={TASK} completeAction={completeAction} />
      </ul>
    );

    fireEvent.click(screen.getByRole("button", { name: /mark complete/i }));
    await waitFor(() => expect(completeAction).toHaveBeenCalledTimes(1));
    const submitted = completeAction.mock.calls[0][0];
    expect(submitted.get("expectedRevision")).toBe("1");
  });

  it("shows a plain status readout instead of the form once the task is no longer pending", () => {
    render(
      <ul>
        <HumanTaskCard task={{ ...TASK, status: "completed" }} completeAction={vi.fn()} />
      </ul>
    );
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark complete/i })).not.toBeInTheDocument();
  });
});
