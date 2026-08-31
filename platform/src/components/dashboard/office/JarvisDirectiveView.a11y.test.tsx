import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JarvisDirectiveView } from "./JarvisDirectiveView";

const liveStatus = {
  project: {
    id: "project-1",
    name: "Launch the client website",
    projectKey: "LYNQ-101",
    status: "active",
    objective: "Launch a production-ready website.",
    directive: "Build and launch the client website.",
  },
  overallState: "needs_approval",
  refreshAfterMs: null,
  steps: [
    {
      taskId: "task-1",
      title: "Approve the final preview",
      state: "needs_approval",
      stage: "review",
      goal: "Confirm the website is ready to launch.",
      handoff: null,
      agent: { id: "agent-1", name: "Design Lead", role: "Design" },
      execution: { id: "execution-1", status: "waiting", waitReason: null },
      approval: { id: "approval-1", status: "pending" },
      deliverable: { id: "artifact-1", title: "Website preview" },
      pullRequestUrl: "https://github.com/example/repository/pull/1",
      previewUrl: "https://example-preview.vercel.app",
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("JarvisDirectiveView accessibility", () => {
  it("renders the live directive, approval action, and handoffs without axe violations", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: liveStatus }), { status: 200 })));

    const { container } = render(
      <JarvisDirectiveView organizationId="organization-1" organizationSlug="lynq" projectId="project-1" />,
    );

    await waitFor(() => expect(screen.getByRole("heading", { name: "Launch the client website" })).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Jarvis needs your approval" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /review approval/i })).toHaveAttribute("href", "/app/lynq/my-work");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("announces a load failure and provides a retry control without axe violations", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Live status is unavailable." } }), { status: 503 })));

    const { container } = render(
      <JarvisDirectiveView organizationId="organization-1" organizationSlug="lynq" projectId="project-1" />,
    );

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Live status is unavailable."));
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
