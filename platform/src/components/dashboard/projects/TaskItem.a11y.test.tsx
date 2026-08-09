import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { TaskItem } from "./TaskItem";
import type { ProjectTask } from "@/lib/projects/tasks";
import type { ActionResult } from "@/lib/dashboard/actions/types";

const TASK: ProjectTask = {
  id: "task-1",
  organizationId: "org-1",
  projectId: "project-1",
  phaseId: null,
  milestoneId: null,
  parentTaskId: null,
  title: "Write curriculum outline",
  description: null,
  status: "backlog",
  priority: "normal",
  taskType: "general",
  startDate: null,
  dueDate: null,
  completedAt: null,
  createdByUserId: "user-1",
  position: 1,
  revision: 3,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function renderTask(overrides: Partial<Parameters<typeof TaskItem>[0]> = {}) {
  const transitionAction = vi.fn(async () => ({ ok: true }) as ActionResult);
  const assignAction = vi.fn(async () => ({ ok: true }) as ActionResult);
  const unassignAction = vi.fn(async () => ({ ok: true }) as ActionResult);
  const addDependencyAction = vi.fn(async () => ({ ok: true }) as ActionResult);
  const launchAgentAction = vi.fn(async () => ({ ok: true }) as ActionResult);

  const utils = render(
    <ul>
      <TaskItem
        task={TASK}
        assignees={[]}
        members={[{ userId: "u2", name: "Sam Contributor", email: "sam@example.com" }]}
        otherTasks={[{ id: "task-2", title: "Set up repo" }]}
        blockedByTitles={[]}
        executionCount={0}
        transitionAction={transitionAction}
        assignAction={assignAction}
        unassignAction={unassignAction}
        addDependencyAction={addDependencyAction}
        launchAgentAction={launchAgentAction}
        {...overrides}
      />
    </ul>
  );
  return { ...utils, transitionAction, assignAction, unassignAction, addDependencyAction, launchAgentAction };
}

describe("TaskItem", () => {
  it("gives the status selector a per-task accessible name and has no axe violations", async () => {
    const { container } = renderTask();
    expect(screen.getByRole("combobox", { name: "Status for Write curriculum outline" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("keeps the assignment, dependency, and agent-launch controls inside a labeled disclosure, accessible once expanded", async () => {
    const { container } = renderTask();
    const disclosure = screen.getByText("More actions");
    expect(disclosure.closest("details")).not.toHaveAttribute("open");

    fireEvent.click(disclosure);
    expect(screen.getByRole("combobox", { name: "Assign to" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Blocked by" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /allowed brain domains/i })).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows an accessible remove control per assignee and calls unassignAction with that user's id", async () => {
    const { unassignAction } = renderTask({ assignees: [{ userId: "u9", name: "Assigned Person", email: "assigned@example.com" }] });
    expect(screen.getByText("Assigned Person")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(unassignAction).toHaveBeenCalledWith("u9"));
  });

  it("surfaces blocked-by and agent-run-count context in the task's own accessible text", () => {
    renderTask({ blockedByTitles: ["Set up repo"], executionCount: 2 });
    expect(screen.getByText(/blocked by set up repo/i)).toBeInTheDocument();
    expect(screen.getByText(/2 agent runs/i)).toBeInTheDocument();
  });
});
