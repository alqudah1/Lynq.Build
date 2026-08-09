import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { ProjectTabs } from "./ProjectTabs";

const TABS = [
  { id: "overview", label: "Overview", content: <p>Overview content</p> },
  { id: "tasks", label: "Tasks", content: <p>Tasks content</p> },
  { id: "activity", label: "Activity", content: <p>Activity content</p> },
];

describe("ProjectTabs", () => {
  it("renders a labeled tablist with exactly one selected tab and no axe violations", async () => {
    const { container } = render(<ProjectTabs tabs={TABS} />);

    expect(screen.getByRole("tablist", { name: "Project sections" })).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs.filter((t) => t.getAttribute("aria-selected") === "true")).toHaveLength(1);
    expect(screen.getByText("Overview content")).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });

  it("only the active tab is in the default tab order; others are reachable via arrow keys", () => {
    render(<ProjectTabs tabs={TABS} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("tabIndex", "0");
    expect(tabs[1]).toHaveAttribute("tabIndex", "-1");
    expect(tabs[2]).toHaveAttribute("tabIndex", "-1");
  });

  it("ArrowRight/ArrowLeft moves selection and swaps the visible panel, wrapping at the ends", () => {
    render(<ProjectTabs tabs={TABS} />);
    const overviewTab = screen.getByRole("tab", { name: "Overview" });
    overviewTab.focus();

    fireEvent.keyDown(overviewTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Tasks" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Tasks content")).toBeInTheDocument();
    expect(screen.queryByText("Overview content")).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("tab", { name: "Tasks" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });

  it("clicking a tab selects it and exposes the panel via aria-labelledby", () => {
    render(<ProjectTabs tabs={TABS} />);
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));

    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveTextContent("Activity content");
    expect(panel.getAttribute("aria-labelledby")).toBe(screen.getByRole("tab", { name: "Activity" }).id);
  });
});
