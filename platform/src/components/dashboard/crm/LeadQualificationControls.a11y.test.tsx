import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { LeadQualificationControls } from "./LeadQualificationControls";
import type { ActionResult } from "@/lib/dashboard/actions/types";

function actions() {
  return {
    qualifyAction: vi.fn(async () => ({ ok: true }) as ActionResult),
    disqualifyAction: vi.fn(async () => ({ ok: true }) as ActionResult),
    convertAction: vi.fn(async () => ({ ok: true }) as ActionResult),
  };
}

const pipelines = [{ id: "p1", name: "Sales", stages: [{ id: "s1", name: "New" }] }];

describe("LeadQualificationControls", () => {
  it("a new lead shows Qualify and Disqualify, never Convert, with no axe violations", async () => {
    const { container } = render(<LeadQualificationControls status="new" expectedRevision={1} canManage pipelines={pipelines} {...actions()} />);
    expect(screen.getByRole("button", { name: "Qualify" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disqualify" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /convert/i })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("a qualified lead shows Convert with a pipeline/stage selector, still Disqualify, never Qualify again", async () => {
    const { container } = render(<LeadQualificationControls status="qualified" expectedRevision={2} canManage pipelines={pipelines} {...actions()} />);
    expect(screen.getByRole("button", { name: /convert to opportunity/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disqualify" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Qualify" })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("a converted lead shows no action controls at all", () => {
    render(<LeadQualificationControls status="converted" expectedRevision={3} canManage pipelines={pipelines} {...actions()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/already been converted/i)).toBeInTheDocument();
  });

  it("renders nothing when the caller cannot manage this lead", () => {
    const { container } = render(<LeadQualificationControls status="new" expectedRevision={1} canManage={false} pipelines={pipelines} {...actions()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
