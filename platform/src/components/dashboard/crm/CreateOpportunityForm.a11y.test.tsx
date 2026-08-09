import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { CreateOpportunityForm } from "./CreateOpportunityForm";
import type { ActionResult } from "@/lib/dashboard/actions/types";

const pipelines = [
  { id: "p1", name: "Sales", stages: [{ id: "s1", name: "New", isClosed: false }] },
  { id: "p2", name: "Partnerships", stages: [{ id: "s2", name: "Intro", isClosed: false }] },
];

describe("CreateOpportunityForm", () => {
  it("renders with no axe violations; amount is never a required field", async () => {
    const action = vi.fn(async () => ({ ok: true }) as ActionResult);
    const { container } = render(<CreateOpportunityForm pipelines={pipelines} contacts={[]} companies={[]} action={action} />);
    expect(screen.getByLabelText(/^name/i)).toBeRequired();
    expect(screen.getByLabelText(/amount/i)).not.toBeRequired();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("switching the pipeline selection updates the offered stage options to that pipeline's own stages", () => {
    const action = vi.fn(async () => ({ ok: true }) as ActionResult);
    render(<CreateOpportunityForm pipelines={pipelines} contacts={[]} companies={[]} action={action} />);

    expect(screen.getByRole("option", { name: "New" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/pipeline/i), { target: { value: "p2" } });
    expect(screen.getByRole("option", { name: "Intro" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "New" })).not.toBeInTheDocument();
  });

  it("shows a message instead of a form when there are no pipelines with an open stage yet", () => {
    const action = vi.fn(async () => ({ ok: true }) as ActionResult);
    render(<CreateOpportunityForm pipelines={[]} contacts={[]} companies={[]} action={action} />);
    expect(screen.getByText(/create a pipeline/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
