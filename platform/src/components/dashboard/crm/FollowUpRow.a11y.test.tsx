import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { FollowUpRow } from "./FollowUpRow";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import type { CrmFollowUp } from "@/lib/crm/follow-ups";

function makeFollowUp(overrides: Partial<CrmFollowUp> = {}): CrmFollowUp {
  return {
    id: "f1",
    organizationId: "org1",
    contactId: "c1",
    companyId: null,
    leadId: null,
    opportunityId: null,
    assignedUserId: "u1",
    title: "Call back",
    dueAt: null,
    status: "open",
    priority: "normal",
    completedAt: null,
    createdByUserId: "u1",
    revision: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("FollowUpRow", () => {
  it("an open follow-up shows Complete and Cancel controls, with no axe violations", async () => {
    const completeAction = vi.fn(async () => ({ ok: true }) as ActionResult);
    const cancelAction = vi.fn(async () => ({ ok: true }) as ActionResult);
    const { container } = render(
      <ul>
        <FollowUpRow followUp={makeFollowUp()} assigneeName="Ada" redirectPath="/x" completeAction={completeAction} cancelAction={cancelAction} />
      </ul>
    );
    expect(screen.getByRole("button", { name: "Complete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("a completed follow-up shows no action controls", () => {
    const completeAction = vi.fn(async () => ({ ok: true }) as ActionResult);
    const cancelAction = vi.fn(async () => ({ ok: true }) as ActionResult);
    render(<FollowUpRow followUp={makeFollowUp({ status: "completed" })} assigneeName="Ada" redirectPath="/x" completeAction={completeAction} cancelAction={cancelAction} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
