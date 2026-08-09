import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { CreateNodeForm } from "./CreateNodeForm";
import type { ActionResult } from "@/lib/dashboard/actions/types";

describe("CreateNodeForm", () => {
  it("labels every field accessibly, defaults to the start node type, and has no axe violations", async () => {
    const action = vi.fn(async () => ({ ok: true }) as ActionResult);
    const { container } = render(<CreateNodeForm action={action} />);

    expect(screen.getByRole("textbox", { name: /node key/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /node type/i })).toHaveValue("start");
    expect(screen.getByLabelText(/configuration \(json\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/input mapping/i)).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });

  it("updates the configuration hint text when a different node type is selected", () => {
    render(<CreateNodeForm action={vi.fn(async () => ({ ok: true }) as ActionResult)} />);

    expect(screen.getByText(/expected shape for "start"/i)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: /node type/i }), { target: { value: "wait" } });
    expect(screen.getByText(/expected shape for "wait"/i)).toBeInTheDocument();
  });
});
