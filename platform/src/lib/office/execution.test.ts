import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentApprovalRequests, projectApprovalLinks, projectArtifactLinks, projectExecutionLinks, projects } from "@/db/schema";
import { brandPack, candidate, collectedBrandPack, packFrom } from "../../../test/support/website-fixtures";
import { DEMO_APPROVAL_ACTION, RESTAURANT_OUTREACH_APPROVAL_ACTION, RESTAURANT_PROSPECT_APPROVAL_ACTION } from "./approvals";
import { formatOfficeTaskDescription, type OfficeDeliveryStage } from "./task-metadata";
import { brandPackMarker, fingerprintBrandPack } from "./website/brand-pack";
import { autoDecisionMarker, autonomyFromDirective, autonomyMarker, parseAutoDecisions, parseIncompleteOutcomes } from "./autonomy";
import { restaurantOutreachMarker } from "./restaurant-outreach";

/**
 * The founder approval gates are the whole reason this workflow is safe to
 * run unattended: an approved research artifact sitting on the project is
 * evidence that Jarvis *proposed* a restaurant, never that the founder
 * accepted it — and an approval covers one exact set of evidence, not
 * whatever evidence happens to be on the project later.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const EXECUTION = "22222222-2222-4222-8222-222222222222";
const AGENT = "33333333-3333-4333-8333-333333333333";
const PROJECT = "44444444-4444-4444-8444-444444444444";
const TASK = "55555555-5555-4555-8555-555555555555";
const OWNER = "66666666-6666-4666-8666-666666666666";
const MESSAGE = "7f1b3d2e-8a4c-4f11-9a0e-2b6d5c8e9f01";

const executeEngineeringDelivery = vi.hoisted(() => vi.fn());
const createArtifact = vi.hoisted(() => vi.fn());
const linkArtifactToEntity = vi.hoisted(() => vi.fn());
const completeExecution = vi.hoisted(() => vi.fn());
const requestApproval = vi.hoisted(() => vi.fn());
const researchRestaurantProspects = vi.hoisted(() => vi.fn());
const collectRestaurantBrandPack = vi.hoisted(() => vi.fn());
const notifyJarvisRunFinished = vi.hoisted(() => vi.fn());
const draftRestaurantOutreach = vi.hoisted(() => vi.fn());
const queueMessageAfterRecordedApproval = vi.hoisted(() => vi.fn());
const createDraftMessage = vi.hoisted(() => vi.fn());
const listConnectionsForUser = vi.hoisted(() => vi.fn());
const findOrCreateConversation = vi.hoisted(() => vi.fn());
const inspectEngineeringDelivery = vi.hoisted(() => vi.fn());
const decideFounderApproval = vi.hoisted(() => vi.fn());
const listArtifactsForExecution = vi.hoisted(() => vi.fn());

vi.mock("./engineering", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./engineering")>()),
  executeEngineeringDelivery,
  inspectEngineeringDelivery,
}));
vi.mock("./restaurant-research", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./restaurant-research")>()),
  researchRestaurantProspects,
}));
vi.mock("./restaurant-brand-collection", () => ({ collectRestaurantBrandPack }));
vi.mock("./restaurant-outreach", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./restaurant-outreach")>()),
  draftRestaurantOutreach,
}));
vi.mock("@/lib/agents/agents", () => ({ resolveAgentById: vi.fn(async () => ({ id: AGENT, organizationId: ORG, name: "Engineering Lead", role: "engineering" })) }));
vi.mock("@/lib/agent-runtime/artifacts", () => ({ createArtifact, listArtifactsForExecution }));
vi.mock("@/lib/agent-runtime/approvals", () => ({ requestApproval }));
vi.mock("@/lib/founder-os/approval-center", () => ({ decideFounderApproval }));
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
  resolveTaskById: vi.fn(async () => ({ id: TASK, status: "in_progress", revision: 1, description: taskDescriptionFor(stage) })),
  transitionTaskStatus: vi.fn(async () => ({ id: TASK, status: "review", revision: 2 })),
}));
vi.mock("@/lib/email/jarvis-notifier", () => ({ notifyJarvisApprovalNeeded: vi.fn(), notifyJarvisRunFinished }));
vi.mock("@/lib/communications-os/connections", () => ({ ensureEnvironmentManagedResendConnection: vi.fn(), listConnectionsForUser }));
vi.mock("@/lib/communications-os/conversations", () => ({ findOrCreateConversation }));
vi.mock("@/lib/communications-os/messages", () => ({ attachMessageToExistingApproval: vi.fn(), createDraftMessage, queueMessageAfterRecordedApproval }));
vi.mock("ai", () => ({ generateText: vi.fn(async () => ({ text: "review" })) }));
vi.mock("./models", () => ({ getOfficeGenerationConfig: () => ({ model: "test" }) }));

let stage: OfficeDeliveryStage = "engineering";

function taskDescriptionFor(current: OfficeDeliveryStage): string {
  return formatOfficeTaskDescription({
    version: 1,
    stage: current,
    agentId: AGENT,
    goal: "Build the approved restaurant's concept website.",
    successCriteria: "A validated preview route the founder can open on a phone.",
    handoff: "Send the preview to Quality Assurance.",
  });
}

const research = {
  searchArea: "Toronto, Canada",
  recommendation: candidate,
  alternatives: [candidate],
  uncertainty: ["Opening hours were only listed on one aggregator."],
};

function researchMarkerFor(overrides: Partial<typeof candidate> = {}): string {
  return `<!-- LYNQ_RESTAURANT_RESEARCH ${JSON.stringify({ ...research, recommendation: { ...candidate, ...overrides } })} -->`;
}

/** What the project looks like when the orchestration reads it. */
type Rows = {
  /** The restaurant and evidence version the founder approved, or null for no approval. */
  approved: { candidate?: Partial<typeof candidate>; fingerprint: string | null } | null;
  /** The evidence currently attached to the project. */
  projectPack: typeof brandPack | null;
  /** The directive text, which is where the autonomy policy comes from. */
  directive?: string;
  /** Put a finished engineering delivery on the project, as the later stages see it. */
  deliveryInContext?: boolean;
  /** Record that Jarvis already accepted the demo on the founder's behalf. */
  demoAcceptedInContext?: boolean;
  /** Record that Jarvis already chose the prospect on the founder's behalf. */
  prospectDecidedInContext?: string | null;
  /** Whether the delivery on the project ever got a preview. */
  deliveryPreviewStatus?: "ready" | "pending";
  /** An approval already on this execution, as the resumed run reads it. */
  approvalOnExecution?: { status: "approved" | "pending" | "rejected" };
};

function makeDb(rows: Rows) {
  const result = (table: unknown) => {
    if (table === projectExecutionLinks) return [{ projectId: PROJECT, taskId: TASK }];
    if (table === projects) {
      return [{
        name: "Sumac & Stone demo",
        projectKey: "SUMAC",
        objective: "Show the kitchen a site that reads on a phone.",
        description: `Founder directive\n\n${rows.directive ?? "Find a restaurant and build it a demo."}\n\n${autonomyMarker(autonomyFromDirective(rows.directive ?? ""))}`,
      }];
    }
    if (table === agentApprovalRequests) {
      return rows.approvalOnExecution ? [{ id: "approval-1", status: rows.approvalOnExecution.status, createdAt: new Date("2026-08-20T11:00:00.000Z"), decisionNote: null }] : [];
    }
    if (table === projectArtifactLinks) {
      return [{
        title: "Restaurant recommendation",
        artifactType: "report",
        content: [
          researchMarkerFor(),
          rows.projectPack ? brandPackMarker(rows.projectPack) : "",
          rows.deliveryInContext
            ? `<!-- LYNQ_ENGINEERING_RESULT ${JSON.stringify({
                ...delivery,
                website: undefined,
                previewStatus: rows.deliveryPreviewStatus ?? "ready",
                previewUrl: (rows.deliveryPreviewStatus ?? "ready") === "ready" ? delivery.previewUrl : null,
              })} -->`
            : "",
          rows.demoAcceptedInContext
            ? autoDecisionMarker({ action: DEMO_APPROVAL_ACTION, decidedAt: "2026-08-20T10:00:00.000Z", policyReason: "handed over", summary: "Accepted the demo.", restaurantName: candidate.name, brandPackFingerprint: null, commitSha: delivery.commitSha })
            : "",
          rows.prospectDecidedInContext !== undefined
            ? autoDecisionMarker({ action: RESTAURANT_PROSPECT_APPROVAL_ACTION, decidedAt: "2026-08-20T09:00:00.000Z", policyReason: "handed over", summary: "Went ahead.", restaurantName: candidate.name, brandPackFingerprint: rows.prospectDecidedInContext, commitSha: null })
            : "",
        ].filter(Boolean).join("\n\n"),
      }];
    }
    if (table === projectApprovalLinks) {
      if (!rows.approved) return [];
      return [{
        content: researchMarkerFor(rows.approved.candidate ?? {}),
        proposedActionRef: { projectId: PROJECT, taskId: TASK, brandPackFingerprint: rows.approved.fingerprint },
      }];
    }
    throw new Error("Unexpected table in the execution test double");
  };

  return {
    select: () => ({
      from: (table: unknown) => {
        const rowsFor = async () => result(table);
        const terminal = () => ({ orderBy: rowsFor, then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => rowsFor().then(resolve, reject) });
        const chain = () => ({ innerJoin: () => chain(), leftJoin: () => chain(), where: terminal });
        return chain();
      },
    }),
  } as never;
}

const APPROVED_FINGERPRINT = fingerprintBrandPack(brandPack);

/** A directive that asks Jarvis to stop at every gate, the way it always used to. */
const SUPERVISED = "Find a restaurant, but check with me first before you build anything.";

const delivery = {
  repository: "alqudah1/lynq.build",
  branch: "office/sumac-abcd1234",
  commitSha: "abc123",
  pullRequestNumber: 7,
  pullRequestUrl: "https://github.com/alqudah1/lynq.build/pull/7",
  previewUrl: "https://preview.vercel.app/demos/sumac-abc123def456",
  previewPath: "/demos/sumac-abc123def456",
  previewStatus: "ready" as const,
  previewCheckedAt: "2026-08-20T00:00:00.000Z",
  validationSummary: "Deterministic validation passed.",
  agentSummary: "Generated a counter-forward concept website.",
  website: {
    designName: "Charcoal counter",
    layout: "counter-forward",
    pages: ["/demos/sumac-abc123def456", "/demos/sumac-abc123def456/menu"],
    designRationale: "## Design direction — Charcoal counter\nThe kitchen leads with fire.",
    evidenceTable: "| Fact | Value | Source | Retrieved | Confidence |",
    uncertainties: ["Opening hours were only listed on one aggregator."],
    qaSummary: "No violations.",
    attempts: 1,
    files: ["platform/src/app/demos/sumac-abc123def456/page.tsx"],
  },
};

async function run(rows: Rows) {
  const { continueOfficeDirectiveExecution } = await import("./execution");
  return continueOfficeDirectiveExecution(makeDb(rows), { organizationId: ORG, executionId: EXECUTION });
}

function allArtifactContent(): string {
  return createArtifact.mock.calls.map((call) => (call[1] as { content: string }).content).join("\n\n");
}

function autoDecisions() {
  return parseAutoDecisions(allArtifactContent());
}

function incompleteOutcomes() {
  return parseIncompleteOutcomes(allArtifactContent());
}

function artifactsByTitle() {
  return new Map(createArtifact.mock.calls.map((call) => {
    const input = call[1] as { title: string; content: string };
    return [input.title, input] as const;
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  stage = "engineering";
  createArtifact.mockImplementation(async (_db: unknown, input: { title: string; content: string }) => ({ id: `artifact-${input.title}`, ...input }));
  listArtifactsForExecution.mockResolvedValue([]);
  executeEngineeringDelivery.mockResolvedValue(delivery);
  completeExecution.mockResolvedValue({ id: EXECUTION, status: "completed" });
  researchRestaurantProspects.mockResolvedValue(research);
  collectRestaurantBrandPack.mockResolvedValue({ pack: brandPack, failure: null });
  requestApproval.mockImplementation(async () => ({ request: { id: "approval-1" }, execution: { id: EXECUTION, status: "human_approval" } }));
  decideFounderApproval.mockResolvedValue({ id: "approval-1", executionId: EXECUTION, status: "approved" });
  notifyJarvisRunFinished.mockResolvedValue({ email: "sent", voice: "sent" });
  inspectEngineeringDelivery.mockResolvedValue({ previewUrl: delivery.previewUrl, checks: "all green" });
  listConnectionsForUser.mockResolvedValue([{ id: "conn-1", provider: "resend", integrationType: "email", status: "connected" }]);
  findOrCreateConversation.mockResolvedValue({ id: "conv-1" });
  draftRestaurantOutreach.mockResolvedValue({ subject: "A concept site for Sumac & Stone", body: "Hello — we built you a concept." });
  createDraftMessage.mockResolvedValue({ id: "7f1b3d2e-8a4c-4f11-9a0e-2b6d5c8e9f01" });
  queueMessageAfterRecordedApproval.mockResolvedValue(undefined);
});

describe("research stage — gathering evidence and putting it to the founder", () => {
  beforeEach(() => {
    stage = "research";
  });

  it("gathers evidence for the recommended restaurant and records it as its own artifact", async () => {
    await run({ approved: null, projectPack: null });

    expect(collectRestaurantBrandPack).toHaveBeenCalledWith({ candidate });
    const artifacts = artifactsByTitle();
    expect([...artifacts.keys()]).toEqual(expect.arrayContaining(["Brand evidence — SUMAC", "Restaurant recommendation — SUMAC"]));
    const evidence = artifacts.get("Brand evidence — SUMAC")!;
    expect(evidence.content).toContain("LYNQ_APPROVED_BRAND_PACK");
    expect(evidence.content).toContain(APPROVED_FINGERPRINT);
  });

  it("shows the founder the evidence, its sources and what could not be verified", async () => {
    await run({ approved: null, projectPack: null });
    const approvalArtifact = artifactsByTitle().get("Restaurant recommendation — SUMAC")!;
    expect(approvalArtifact.content).toContain("LYNQ_RESTAURANT_RESEARCH");
    expect(approvalArtifact.content).toContain("Approve the prospect and its evidence");
    expect(approvalArtifact.content).toContain("| Fact | Value | Source | Retrieved | Confidence |");
    expect(approvalArtifact.content).toContain("## Not verified");
    expect(approvalArtifact.content).toContain("Opening hours were only listed on one aggregator.");
    expect(approvalArtifact.content).toContain("## Recommended design direction");
  });

  it("binds the approval it requests to that exact evidence version when the founder asked to be consulted", async () => {
    await run({ approved: null, projectPack: brandPack, directive: SUPERVISED });
    const approval = requestApproval.mock.calls[0]![1] as { requestedAction: string; summary: string; proposedActionRef: Record<string, unknown> };
    expect(approval.requestedAction).toBe(RESTAURANT_PROSPECT_APPROVAL_ACTION);
    expect(approval.proposedActionRef.brandPackFingerprint).toBe(APPROVED_FINGERPRINT);
    expect(approval.summary).toContain("this exact evidence");
    expect(approval.summary).toContain(APPROVED_FINGERPRINT);
  });

  it("says plainly in the approval when no evidence could be gathered", async () => {
    collectRestaurantBrandPack.mockResolvedValue({
      pack: packFrom({ ...collectedBrandPack, images: [], menu: [], hours: [], services: [], facts: [], brandSignals: [] }),
      failure: "The research provider did not respond.",
    });
    await run({ approved: null, projectPack: null });
    const approvalArtifact = artifactsByTitle().get("Restaurant recommendation — SUMAC")!;
    expect(approvalArtifact.content).toContain("Evidence collection did not finish");
    expect(approvalArtifact.content).toContain("The research provider did not respond.");
  });
});

describe("engineering stage — founder approval enforcement", () => {
  it("refuses to build a prospect website before the founder has approved the restaurant", async () => {
    await expect(run({ approved: null, projectPack: brandPack })).rejects.toThrow(/waiting for the founder to approve the restaurant/i);
    expect(executeEngineeringDelivery).not.toHaveBeenCalled();
  });

  it("refuses to build a restaurant the founder did not approve, even when another approval exists", async () => {
    await expect(run({ approved: { candidate: { name: "A completely different kitchen" }, fingerprint: APPROVED_FINGERPRINT }, projectPack: brandPack }))
      .rejects.toThrow(/approve the restaurant \(Sumac & Stone\)/);
    expect(executeEngineeringDelivery).not.toHaveBeenCalled();
  });

  it("builds from the approved evidence version and records what was built", async () => {
    await run({ approved: { fingerprint: APPROVED_FINGERPRINT }, projectPack: brandPack });

    expect(executeEngineeringDelivery).toHaveBeenCalledTimes(1);
    const passed = executeEngineeringDelivery.mock.calls[0]![0] as { organizationId: string; projectId: string; approvedBrandPackFingerprint: string | null; sharedContext: string };
    expect(passed.organizationId).toBe(ORG);
    expect(passed.projectId).toBe(PROJECT);
    expect(passed.approvedBrandPackFingerprint).toBe(APPROVED_FINGERPRINT);
    expect(passed.sharedContext).toContain("LYNQ_RESTAURANT_RESEARCH");

    const artifacts = artifactsByTitle();
    expect([...artifacts.keys()]).toEqual(expect.arrayContaining(["Engineering delivery — SUMAC", "Concept website — SUMAC"]));
    const website = artifacts.get("Concept website — SUMAC")!;
    expect(website.content).toContain("**Status: built.**");
    expect(website.content).toContain("https://preview.vercel.app/demos/sumac-abc123def456");
    expect(website.content).toContain("Evidence behind every visible fact");
    expect(linkArtifactToEntity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ artifactId: "artifact-Concept website — SUMAC", linkedEntityId: TASK }));
  });

  describe("evidence modified after approval", () => {
    it("stops, and says the evidence changed, when the project's evidence no longer matches the approval", async () => {
      const changed = packFrom({ ...collectedBrandPack, images: collectedBrandPack.images.slice(0, 1) });
      expect(fingerprintBrandPack(changed)).not.toBe(APPROVED_FINGERPRINT);

      await expect(run({ approved: { fingerprint: APPROVED_FINGERPRINT }, projectPack: changed }))
        .rejects.toThrow(/evidence on this project has changed since you approved it/i);
      expect(executeEngineeringDelivery).not.toHaveBeenCalled();
    });

    it("stops the build, but not the run, when no evidence version was approved", async () => {
      await run({ approved: { fingerprint: null }, projectPack: brandPack });
      expect(executeEngineeringDelivery).not.toHaveBeenCalled();
      const recorded = incompleteOutcomes();
      expect(recorded[0]?.headline).toMatch(/no approved evidence to build from/i);
      expect(recorded[0]?.stage).toBe("engineering");
    });

    it("stops the build, but not the run, when the approved evidence is gone", async () => {
      await run({ approved: { fingerprint: APPROVED_FINGERPRINT }, projectPack: null });
      expect(executeEngineeringDelivery).not.toHaveBeenCalled();
      expect(incompleteOutcomes()).toHaveLength(1);
    });

    it("still refuses outright when the founder asked to be consulted", async () => {
      await expect(run({ approved: { fingerprint: null }, projectPack: brandPack, directive: SUPERVISED }))
        .rejects.toThrow(/no approved evidence version recorded/i);
      expect(executeEngineeringDelivery).not.toHaveBeenCalled();
    });

    it("explains the difference between changed evidence and no evidence in words the founder can act on", async () => {
      const { explainJarvisFailure } = await import("./jarvis-presentation");
      const changed = packFrom({ ...collectedBrandPack, images: collectedBrandPack.images.slice(0, 1) });
      const raised = await run({ approved: { fingerprint: APPROVED_FINGERPRINT }, projectPack: changed }).catch((error: unknown) => error as Error);
      expect(explainJarvisFailure((raised as Error).message)?.headline).toMatch(/evidence changed after you approved it/i);
    });
  });

  describe("reporting what was actually built", () => {
    it("refuses to call a commit with no preview a finished demo", async () => {
      executeEngineeringDelivery.mockResolvedValue({ ...delivery, previewUrl: null, previewStatus: "pending" });
      await run({ approved: { fingerprint: APPROVED_FINGERPRINT }, projectPack: brandPack });

      const website = artifactsByTitle().get("Concept website — SUMAC")!;
      expect(website.content).toContain("**Status: not finished.**");
      expect(website.content).toContain("a working preview link");
      expect(website.content).toContain("had not appeared yet");
      expect(website.content).not.toContain("**Status: built.**");
    });

    it("says the deployment may have failed when the preview could not be read at all", async () => {
      executeEngineeringDelivery.mockResolvedValue({ ...delivery, previewUrl: null, previewStatus: "unavailable" });
      await run({ approved: { fingerprint: APPROVED_FINGERPRINT }, projectPack: brandPack });
      expect(artifactsByTitle().get("Concept website — SUMAC")!.content).toContain("the deployment may have failed");
    });
  });

  it("keeps the machine-readable delivery marker free of the website report", async () => {
    await run({ approved: { fingerprint: APPROVED_FINGERPRINT }, projectPack: brandPack });
    const engineering = artifactsByTitle().get("Engineering delivery — SUMAC")!;
    const marker = /<!-- LYNQ_ENGINEERING_RESULT ([\s\S]*?) -->/.exec(engineering.content)?.[1];
    expect(marker).toBeTruthy();
    const parsed = JSON.parse(marker!) as Record<string, unknown>;
    expect(parsed.website).toBeUndefined();
    expect(parsed.previewPath).toBe("/demos/sumac-abc123def456");
    expect(parsed.previewStatus).toBe("ready");
  });

  it("names the approval action it is waiting for", () => {
    expect(RESTAURANT_PROSPECT_APPROVAL_ACTION).toBe("restaurant_prospect_selection");
  });
});

describe("running the whole directive without the founder", () => {
  it("decides the prospect itself and moves on, instead of waiting", async () => {
    stage = "research";
    await run({ approved: null, projectPack: brandPack });

    expect(requestApproval).not.toHaveBeenCalled();
    const [decision] = autoDecisions();
    expect(decision?.action).toBe(RESTAURANT_PROSPECT_APPROVAL_ACTION);
    expect(decision?.restaurantName).toBe("Sumac & Stone");
    expect(decision?.brandPackFingerprint).toBe(APPROVED_FINGERPRINT);
    expect(decision?.summary).toContain("Went ahead with Sumac & Stone");
  });

  it("treats its own decision as the licence to build, bound to that evidence version", async () => {
    stage = "engineering";
    // No founder approval anywhere — only the decision Jarvis recorded.
    await run({ approved: null, projectPack: brandPack, prospectDecidedInContext: APPROVED_FINGERPRINT });

    expect(executeEngineeringDelivery).toHaveBeenCalledTimes(1);
    const passed = executeEngineeringDelivery.mock.calls[0]![0] as { approvedBrandPackFingerprint: string | null };
    expect(passed.approvedBrandPackFingerprint).toBe(APPROVED_FINGERPRINT);
  });

  it("will not build on its own decision once the evidence underneath it has changed", async () => {
    stage = "engineering";
    const changed = packFrom({ ...collectedBrandPack, images: collectedBrandPack.images.slice(0, 1) });
    await expect(run({ approved: null, projectPack: changed, prospectDecidedInContext: APPROVED_FINGERPRINT }))
      .rejects.toThrow(/evidence on this project has changed/i);
    expect(executeEngineeringDelivery).not.toHaveBeenCalled();
  });

  it("accepts a finished demo on the founder's behalf", async () => {
    stage = "qa";
    await run({ approved: { fingerprint: APPROVED_FINGERPRINT }, projectPack: brandPack, deliveryInContext: true });

    expect(requestApproval).not.toHaveBeenCalled();
    const decision = autoDecisions().find((item) => item.action === DEMO_APPROVAL_ACTION);
    expect(decision?.commitSha).toBe(delivery.commitSha);
    expect(decision?.summary).toContain(delivery.previewUrl);
  });

  it("refuses to accept a demo that was never finished, and says so", async () => {
    stage = "qa";
    // A commit exists and QA could review it, but the delivery on record
    // never got a preview — so there is nothing a founder could open.
    await run({ approved: { fingerprint: APPROVED_FINGERPRINT }, projectPack: brandPack, deliveryInContext: true, deliveryPreviewStatus: "pending" });

    expect(autoDecisions().some((item) => item.action === DEMO_APPROVAL_ACTION)).toBe(false);
    const recorded = incompleteOutcomes();
    expect(recorded[0]?.headline).toMatch(/did not accept it/i);
    expect(recorded[0]?.detail).toContain("a working preview link");
  });

  it("sends the one email itself when the founder handed outreach over", async () => {
    stage = "outreach";
    await run({
      approved: { fingerprint: APPROVED_FINGERPRINT },
      projectPack: brandPack,
      deliveryInContext: true,
      demoAcceptedInContext: true,
      directive: "Find a restaurant, build the demo and send the email yourself.",
    });

    // The rule that an agent cannot mail anyone without a recorded approval
    // a person's authority decided is not weakened by the delegation: the
    // approval is raised exactly as it would be, and then decided through
    // the founder's own approval path.
    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(decideFounderApproval).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ approvalId: "approval-1", decision: "approve", actorUserId: OWNER }),
    );
    expect((decideFounderApproval.mock.calls[0]![1] as { decisionNote: string }).decisionNote).toMatch(/autonomy the founder set/i);
    const decision = autoDecisions().find((item) => item.action === RESTAURANT_OUTREACH_APPROVAL_ACTION);
    expect(decision?.summary).toContain("Sent one email to hello@sumacandstone.example.ca");
  });

  it("never queues the email on a second path of its own", async () => {
    stage = "outreach";
    await run({
      approved: { fingerprint: APPROVED_FINGERPRINT },
      projectPack: brandPack,
      deliveryInContext: true,
      demoAcceptedInContext: true,
      directive: "Find a restaurant, build the demo and send the email yourself.",
    });

    // Deciding the approval resumes the execution, and the resume is the one
    // and only place an outreach message is ever queued for sending. Queueing
    // here too would be a second send path — and, because the message would
    // no longer be pending approval on the resume, it would also throw.
    expect(queueMessageAfterRecordedApproval).not.toHaveBeenCalled();
  });

  it("queues the email once the approval covering it is approved, whoever decided it", async () => {
    stage = "outreach";
    // The single send path: an outreach message is queued only on a resume
    // that finds an approved approval on this execution. Both lanes arrive
    // here — the founder tapping Approve, and Jarvis deciding under a policy
    // the founder handed over.
    listArtifactsForExecution.mockResolvedValue([{
      id: "artifact-outreach",
      createdAt: new Date("2026-08-20T12:00:00.000Z"),
      content: restaurantOutreachMarker({ messageId: MESSAGE, recipient: candidate.email!, previewUrl: delivery.previewUrl }),
    }]);
    await run({
      approved: { fingerprint: APPROVED_FINGERPRINT },
      projectPack: brandPack,
      deliveryInContext: true,
      demoAcceptedInContext: true,
      approvalOnExecution: { status: "approved" },
    });

    expect(queueMessageAfterRecordedApproval).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ messageId: MESSAGE, actorUserId: OWNER }));
  });

  it("sends nothing while the approval covering the email is still pending", async () => {
    stage = "outreach";
    await run({
      approved: { fingerprint: APPROVED_FINGERPRINT },
      projectPack: brandPack,
      deliveryInContext: true,
      demoAcceptedInContext: true,
      approvalOnExecution: { status: "pending" },
    });

    expect(queueMessageAfterRecordedApproval).not.toHaveBeenCalled();
    expect(createDraftMessage).not.toHaveBeenCalled();
  });

  it("drafts the email and waits, when the founder did not hand outreach over", async () => {
    stage = "outreach";
    await run({
      approved: { fingerprint: APPROVED_FINGERPRINT },
      projectPack: brandPack,
      deliveryInContext: true,
      demoAcceptedInContext: true,
    });

    expect(queueMessageAfterRecordedApproval).not.toHaveBeenCalled();
    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect((requestApproval.mock.calls[0]![1] as { requestedAction: string }).requestedAction).toBe(RESTAURANT_OUTREACH_APPROVAL_ACTION);
  });

  it("writes one report at the end and tells the founder once", async () => {
    stage = "qa";
    await run({ approved: { fingerprint: APPROVED_FINGERPRINT }, projectPack: brandPack, deliveryInContext: true });

    const report = artifactsByTitle().get("Run report — SUMAC");
    expect(report).toBeTruthy();
    expect(report!.content).toContain("what Jarvis did");
    expect(report!.content).toContain("Sumac & Stone");
    expect(report!.content).toContain("## What Jarvis decided without you");
    expect(notifyJarvisRunFinished).toHaveBeenCalledTimes(1);
    const notified = notifyJarvisRunFinished.mock.calls[0]![1] as { headline: string; needsFounder: string[] };
    expect(notified.headline).toContain("Sumac & Stone");
  });
});
