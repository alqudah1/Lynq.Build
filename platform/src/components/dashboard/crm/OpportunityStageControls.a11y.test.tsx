import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { OpportunityStageControls } from "./OpportunityStageControls";
import type { ActionResult } from "@/lib/dashboard/actions/types";

function actions() {
  return {
    moveAction: vi.fn(async () => ({ ok: true }) as ActionResult),
    reopenAction: vi.fn(async () => ({ ok: true }) as ActionResult),
  };
}

const allStages = [
  { id: "s1", name: "New" },
  { id: "s2", name: "Won" },
];
const openStages = [{ id: "s1", name: "New" }];

describe("OpportunityStageControls", () => {
  it("an open opportunity shows the Move form (offering every stage, including closed ones), with no axe violations", async () => {
    const { container } = render(<OpportunityStageControls status="open" expectedRevision={1} canManage allStages={allStages} openStages={openStages} {...actions()} />);
    expect(screen.getByRole("button", { name: "Move" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reopen" })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("a closed (won/lost) opportunity shows only the Reopen form, restricted to open stages", async () => {
    const { container } = render(<OpportunityStageControls status="won" expectedRevision={2} canManage allStages={allStages} openStages={openStages} {...actions()} />);
    expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move" })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("renders nothing when the caller cannot manage this opportunity", () => {
    const { container } = render(<OpportunityStageControls status="open" expectedRevision={1} canManage={false} allStages={allStages} openStages={openStages} {...actions()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
