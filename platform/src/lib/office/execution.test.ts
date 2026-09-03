import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentApprovalRequests, projectApprovalLinks, projectArtifactLinks, projectExecutionLinks, projects } from "@/db/schema";
import { brandPack, candidate } from "../../../test/support/website-fixtures";
import { RESTAURANT_PROSPECT_APPROVAL_ACTION } from "./approvals";
import { formatOfficeTaskDescription } from "./task-metadata";
import { brandPackMarker } from "./website/evidence";

/**
 * The founder approval gates are the whole reason this workflow is safe to
 * run unattended: an approved research artifact sitting on the project is
 * evidence that Jarvis *proposed* a restaurant, never that the founder
 * accepted it. These tests drive the real orchestration and assert that a
 * missing approval stops the build outright — and that an approved one
 * lets it through and records what was built.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const EXECUTION = "22222222-2222-4222-8222-222222222222";
const AGENT = "33333333-3333-4333-8333-333333333333";
const PROJECT = "44444444-4444-4444-8444-444444444444";
const TASK = "55555555-5555-4555-8555-555555555555";
const OWNER = "66666666-6666-4666-8666-666666666666";

const executeEngineeringDelivery = vi.hoisted(() => vi.fn());
const createArtifact = vi.hoisted(() => vi.fn());
const linkArtifactToEntity = vi.hoisted(() => vi.fn());
const completeExecution = vi.hoisted(() => vi.fn());

vi.mock("./engineering", () => ({
  executeEngineeringDelivery,
  inspectEngineeringDelivery: vi.fn(),
}));
vi.mock("@/lib/agents/agents", () => ({ resolveAgentById: vi.fn(async () => ({ id: AGENT, organizationId: ORG, name: "Engineering Lead", role: "engineering" })) }));
vi.mock("@/lib/agent-runtime/artifacts", () => ({
  createArtifact,
  listArtifactsForExecution: vi.fn(async () => []),
}));
vi.mock("@/lib/agent-runtime/approvals", () => ({ requestApproval: vi.fn() }));
vi.mock("@/lib/agent-runtime/checkpoints", () => ({ listCheckpointsForExecution: vi.fn(async () => []) }));
vi.mock("@/lib/agent-runtime/executions", () => ({
  resolveExecutionById: vi.fn(async () => ({ id: EXECUTION, organizationId: ORG, status: "executing", assignedAgentId: AGENT, ownerUserId: OWNER })),
}));
vi.mock("@/lib/agent-runtime/lifecycle", () => ({ advanceExecution: vi.fn(async () => undefined), completeExecution }));
vi.mock("@/lib/agent-runtime/plans", () => ({
  getLatestPlan: vi.fn(async () => ({ id: "plan-1" })),
  getPlanSteps: vi.fn(async () => []),
  completePlanStep: vi.fn(async () => undefined),
}));
vi.mock("@/lib/projects/dependencies", () => ({ getUnresolvedBlockingTaskIds: vi.fn(async () => []) }));
vi.mock("@/lib/projects/links", () => ({
  launchAgentForTask: vi.fn(),
  listArtifactLinks: vi.fn(async () => []),
  linkApprovalToEntity: vi.fn(),
  linkArtifactToEntity,
}));
vi.mock("@/lib/projects/projects", () => ({
  resolveProjectById: vi.fn(async () => ({ id: PROJECT, status: "active", revision: 1 })),
  transitionProjectStatus: vi.fn(),
}));
vi.mock("@/lib/projects/tasks", () => ({
  listTasks: vi.fn(async () => []),
  resolveTaskById: vi.fn(async () => ({ id: TASK, status: "in_progress", revision: 1, description: taskDescription })),
  transitionTaskStatus: vi.fn(async () => ({ id: TASK, status: "review", revision: 2 })),
}));
vi.mock("@/lib/email/jarvis-notifier", () => ({ notifyJarvisApprovalNeeded: vi.fn() }));
vi.mock("@/lib/communications-os/connections", () => ({ ensureEnvironmentManagedResendConnection: vi.fn(), listConnectionsForUser: vi.fn(async () => []) }));
vi.mock("@/lib/communications-os/conversations", () => ({ findOrCreateConversation: vi.fn() }));
vi.mock("@/lib/communications-os/messages", () => ({ attachMessageToExistingApproval: vi.fn(), createDraftMessage: vi.fn(), queueMessageAfterRecordedApproval: vi.fn() }));
vi.mock("ai", () => ({ generateText: vi.fn(async () => ({ text: "review" })) }));
vi.mock("./models", () => ({ getOfficeGenerationConfig: () => ({ model: "test" }) }));

const taskDescription = formatOfficeTaskDescription({
  version: 1,
  stage: "engineering",
  agentId: AGENT,
  goal: "Build the approved restaurant's concept website.",
  successCriteria: "A validated preview route the founder can open on a phone.",
  handoff: "Send the preview to Quality Assurance.",
});

function researchMarkerFor(name: string): string {
  return `<!-- LYNQ_RESTAURANT_RESEARCH ${JSON.stringify({
    searchArea: "Toronto, Canada",
    recommendation: { ...candidate, name },
    alternatives: [candidate],
    uncertainty: ["Opening hours were only listed on one aggregator."],
  })} -->`;
}

const researchMarker = researchMarkerFor(candidate.name);

/**
 * Rows the orchestration reads. `approvedRestaurant` is the name the
 * founder actually approved, so a test can approve one restaurant and try
 * to build another.
 */
type Rows = { approvedRestaurant: string | null };

function makeDb(rows: Rows) {
  const result = (table: unknown) => {
    if (table === projectExecutionLinks) return [{ projectId: PROJECT, taskId: TASK }];
    if (table === projects) return [{ name: "Sumac & Stone demo", projectKey: "SUMAC", objective: "Show the kitchen a site that reads on a phone.", description: "Prospect demo" }];
    if (table === agentApprovalRequests) return [];
    if (table === projectArtifactLinks) {
      return [{ title: "Restaurant recommendation", artifactType: "report", content: `${researchMarker}\n\n${brandPackMarker(brandPack)}` }];
    }
    if (table === projectApprovalLinks) {
      return rows.approvedRestaurant === null ? [] : [{ content: researchMarkerFor(rows.approvedRestaurant) }];
    }
    throw new Error("Unexpected table in the execution test double");
  };

  return {
    select: () => ({
      from: (table: unknown) => {
        const chain = () => ({
          innerJoin: () => chain(),
          leftJoin: () => chain(),
          where: async () => result(table),
        });
        return chain();
      },
    }),
  } as never;
}

const delivery = {
  repository: "alqudah1/lynq.build",
  branch: "office/sumac-abcd1234",
  commitSha: "abc123",
  pullRequestNumber: 7,
  pullRequestUrl: "https://github.com/alqudah1/lynq.build/pull/7",
  previewUrl: "https://preview.vercel.app/demos/sumac",
  previewPath: "/demos/sumac",
  validationSummary: "Deterministic validation passed.",
  agentSummary: "Generated a counter-forward concept website.",
  website: {
    designName: "Charcoal counter",
    layout: "counter-forward",
    pages: ["/demos/sumac", "/demos/sumac/menu", "/demos/sumac/visit"],
    designRationale: "## Design direction — Charcoal counter\nThe kitchen leads with fire.",
    evidenceTable: "| Fact | Value | Evidence |",
    uncertainties: ["Opening hours were only listed on one aggregator."],
    qaSummary: "No violations.",
    attempts: 1,
    files: ["platform/src/app/demos/sumac/page.tsx"],
  },
};

async function run(rows: Rows) {
  const { continueOfficeDirectiveExecution } = await import("./execution");
  return continueOfficeDirectiveExecution(makeDb(rows), { organizationId: ORG, executionId: EXECUTION });
}

beforeEach(() => {
  vi.clearAllMocks();
  createArtifact.mockImplementation(async (_db: unknown, input: { title: string; content: string }) => ({ id: `artifact-${input.title}`, ...input }));
  executeEngineeringDelivery.mockResolvedValue(delivery);
  completeExecution.mockResolvedValue({ id: EXECUTION, status: "completed" });
});

describe("Office engineering stage — founder approval enforcement", () => {
  it("refuses to build a prospect website before the founder has approved the restaurant", async () => {
    await expect(run({ approvedRestaurant: null })).rejects.toThrow(/waiting for the founder to approve the restaurant/i);
    expect(executeEngineeringDelivery).not.toHaveBeenCalled();
  });

  it("builds once the restaurant selection is approved, and records the site, its evidence and its uncertainties", async () => {
    await run({ approvedRestaurant: candidate.name });

    expect(executeEngineeringDelivery).toHaveBeenCalledTimes(1);
    const passed = executeEngineeringDelivery.mock.calls[0]![0] as { sharedContext: string; projectKey: string };
    expect(passed.projectKey).toBe("SUMAC");
    expect(passed.sharedContext).toContain("LYNQ_RESTAURANT_RESEARCH");

    const titles = createArtifact.mock.calls.map((call) => (call[1] as { title: string }).title);
    expect(titles).toContain("Engineering delivery — SUMAC");
    expect(titles).toContain("Concept website — SUMAC");

    const website = createArtifact.mock.calls.map((call) => call[1] as { title: string; content: string }).find((item) => item.title === "Concept website — SUMAC")!;
    expect(website.content).toContain("https://preview.vercel.app/demos/sumac");
    expect(website.content).toContain("Charcoal counter");
    expect(website.content).toContain("Evidence behind every visible fact");
    expect(website.content).toContain("Opening hours were only listed on one aggregator.");
    expect(website.content).toContain("/demos/sumac/menu");

    // The concept website report is linked to the task so it appears on the project.
    expect(linkArtifactToEntity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ artifactId: "artifact-Concept website — SUMAC", linkedEntityId: TASK }));
  });

  it("keeps the machine-readable delivery marker free of the website report", async () => {
    await run({ approvedRestaurant: candidate.name });
    const engineering = createArtifact.mock.calls.map((call) => call[1] as { title: string; content: string }).find((item) => item.title === "Engineering delivery — SUMAC")!;
    const marker = /<!-- LYNQ_ENGINEERING_RESULT ([\s\S]*?) -->/.exec(engineering.content)?.[1];
    expect(marker).toBeTruthy();
    const parsed = JSON.parse(marker!) as Record<string, unknown>;
    expect(parsed.website).toBeUndefined();
    expect(parsed.previewPath).toBe("/demos/sumac");
  });

  it("refuses to build a restaurant the founder did not approve, even when another approval exists", async () => {
    await expect(run({ approvedRestaurant: "A completely different kitchen" })).rejects.toThrow(/approve the restaurant \(Sumac & Stone\)/);
    expect(executeEngineeringDelivery).not.toHaveBeenCalled();
  });

  it("names the approval action it is waiting for", () => {
    expect(RESTAURANT_PROSPECT_APPROVAL_ACTION).toBe("restaurant_prospect_selection");
  });
});
