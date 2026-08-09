import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { NoteCard } from "./NoteCard";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import type { CrmNote } from "@/lib/crm/notes";

const note: CrmNote = {
  id: "n1",
  organizationId: "org1",
  contactId: "c1",
  companyId: null,
  leadId: null,
  opportunityId: null,
  authorUserId: "u1",
  content: "Internal note content",
  revision: 1,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("NoteCard", () => {
  it("renders the note content, author, and an accessible Archive control with no axe violations", async () => {
    const archiveAction = vi.fn(async () => ({ ok: true }) as ActionResult);
    const { container } = render(
      <ul>
        <NoteCard note={note} authorName="Ada Lovelace" redirectPath="/x" archiveAction={archiveAction} />
      </ul>
    );
    expect(screen.getByText("Internal note content")).toBeInTheDocument();
    expect(screen.getByText(/ada lovelace/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
