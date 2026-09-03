import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { generateText } from "ai";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agentApprovalRequests, agentArtifacts, projectApprovalLinks, projectArtifactLinks, projectExecutionLinks, projects } from "@/db/schema";
import { resolveAgentById } from "@/lib/agents/agents";
import { createArtifact, listArtifactsForExecution } from "@/lib/agent-runtime/artifacts";
import { requestApproval } from "@/lib/agent-runtime/approvals";
import { listCheckpointsForExecution } from "@/lib/agent-runtime/checkpoints";
import { resolveExecutionById, type AgentExecutionStatus } from "@/lib/agent-runtime/executions";
import { advanceExecution, completeExecution } from "@/lib/agent-runtime/lifecycle";
import { completePlanStep, getLatestPlan, getPlanSteps } from "@/lib/agent-runtime/plans";
import { getUnresolvedBlockingTaskIds } from "@/lib/projects/dependencies";
import { launchAgentForTask, listArtifactLinks, linkApprovalToEntity, linkArtifactToEntity } from "@/lib/projects/links";
import { resolveProjectById, transitionProjectStatus } from "@/lib/projects/projects";
import { listTasks, resolveTaskById, transitionTaskStatus } from "@/lib/projects/tasks";
import { demoIsBuilt, executeEngineeringDelivery, inspectEngineeringDelivery, missingDemoParts, type EngineeringDeliveryResult } from "./engineering";
import { approvalMatchesBrandPack, approvalMatchesDelivery, DEMO_APPROVAL_ACTION, isSameRestaurantIdentity, RESTAURANT_OUTREACH_APPROVAL_ACTION, RESTAURANT_PROSPECT_APPROVAL_ACTION } from "./approvals";
import { collectRestaurantBrandPack } from "./restaurant-brand-collection";
import { brandPackMarker, fingerprintBrandPack, parseBrandPack } from "./website/brand-pack";
import { approvalSummaryLine, renderProspectApproval } from "./website/founder-review";
import { getDirectiveDomains } from "./directives";
import { parseOfficeTaskMetadata } from "./task-metadata";
import { getOfficeGenerationConfig } from "./models";
import { getAgentOfficeIdentity } from "./view";
import { notifyJarvisApprovalNeeded } from "@/lib/email/jarvis-notifier";
import { renderRestaurantResearch, researchRestaurantProspects, restaurantResearchMarker } from "./restaurant-research";
import { parseRestaurantResearch, type RestaurantCandidate } from "./restaurant-research";
import { draftRestaurantOutreach, parseRestaurantOutreach, restaurantOutreachMarker } from "./restaurant-outreach";
import { ensureEnvironmentManagedResendConnection, listConnectionsForUser } from "@/lib/communications-os/connections";
import { findOrCreateConversation } from "@/lib/communications-os/conversations";
import { attachMessageToExistingApproval, createDraftMessage, queueMessageAfterRecordedApproval } from "@/lib/communications-os/messages";

type Db = NeonHttpDatabase<Record<string, unknown>>;

const ENGINEERING_RESULT_START = "<!-- LYNQ_ENGINEERING_RESULT ";
const ENGINEERING_RESULT_END = " -->";

export async function isOfficeDirectiveExecution(db: Db, organizationId: string, executionId: string): Promise<boolean> {
  const checkpoints = await listCheckpointsForExecution(db, organizationId, executionId);
  return checkpoints.some((checkpoint) => checkpoint.safeStateSummary.officeDirectiveExecution === true);
}

async function advanceIfAt(db: Db, organizationId: string, executionId: string, agentId: string, from: AgentExecutionStatus, to: AgentExecutionStatus): Promise<void> {
  const current = await resolveExecutionById(db, organizationId, executionId);
  if (current.status === from) await advanceExecution(db, { organizationId, executionId, actorAgentId: agentId, toStatus: to });
}

function completed(stepNumber: number, statuses: Map<number, string>): boolean {
  return statuses.get(stepNumber) === "completed";
}

function engineeringMarker(result: EngineeringDeliveryResult): string {
  return `${ENGINEERING_RESULT_START}${JSON.stringify(result)}${ENGINEERING_RESULT_END}`;
}

function parseEngineeringResult(content: string | null): EngineeringDeliveryResult | null {
  if (!content) return null;
  const start = content.lastIndexOf(ENGINEERING_RESULT_START);
  const end = content.indexOf(ENGINEERING_RESULT_END, start + ENGINEERING_RESULT_START.length);
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(content.slice(start + ENGINEERING_RESULT_START.length, end)) as EngineeringDeliveryResult;
  } catch {
    return null;
  }
}

/**
 * The founder approves the restaurant before anything is built for it.
 * Engineering therefore refuses to run for a prospect demo until an
 * approved `restaurant_prospect_selection` is recorded against the
 * project — the research artifact being present is not consent, and the
 * approval lives on the research execution rather than this one, so it has
 * to be looked up project-wide.
 */
type ApprovedActionEvidence = { content: string | null; proposedActionRef: unknown };

async function approvedActionEvidence(db: Db, organizationId: string, projectId: string, requestedAction: string): Promise<ApprovedActionEvidence[]> {
  const rows = await db
    .select({ content: agentArtifacts.content, proposedActionRef: agentApprovalRequests.proposedActionRef })
    .from(projectApprovalLinks)
    .innerJoin(
      agentApprovalRequests,
      and(eq(agentApprovalRequests.id, projectApprovalLinks.approvalRequestId), eq(agentApprovalRequests.organizationId, projectApprovalLinks.organizationId)),
    )
    .leftJoin(agentArtifacts, eq(agentArtifacts.id, agentApprovalRequests.artifactId))
    .where(
      and(
        eq(projectApprovalLinks.organizationId, organizationId),
        eq(projectApprovalLinks.projectId, projectId),
        eq(agentApprovalRequests.requestedAction, requestedAction),
        eq(agentApprovalRequests.status, "approved"),
      ),
    );
  return rows;
}

/**
 * An approval is for one named restaurant, not for restaurants in general.
 * Re-researching after an approval produces a different recommendation, so
 * the gate compares the restaurant about to be built against the ones the
 * founder actually approved on this project.
 */
async function founderApprovedThisRestaurant(db: Db, organizationId: string, projectId: string, candidate: RestaurantCandidate): Promise<boolean> {
  const approvals = await approvedActionEvidence(db, organizationId, projectId, RESTAURANT_PROSPECT_APPROVAL_ACTION);
  return approvals.some(({ content }) => {
    const approved = parseRestaurantResearch(content)?.recommendation;
    return approved ? isSameRestaurantIdentity(approved, candidate) : false;
  });
}

/**
 * The evidence version this project's prospect approval covers, or null
 * when the founder has not approved any. Engineering passes it to the
 * factory, which refuses to build from anything else.
 */
type EvidenceApproval =
  | { status: "approved"; fingerprint: string }
  | { status: "changed"; fingerprint: null }
  | { status: "missing"; fingerprint: null };

async function approvedBrandPackFingerprint(db: Db, organizationId: string, projectId: string, candidate: RestaurantCandidate, sharedContext: string): Promise<EvidenceApproval> {
  const pack = parseBrandPack(sharedContext);
  const approvals = await approvedActionEvidence(db, organizationId, projectId, RESTAURANT_PROSPECT_APPROVAL_ACTION);
  const forThisRestaurant = approvals.filter(({ content }) => {
    const approved = parseRestaurantResearch(content)?.recommendation;
    return approved ? isSameRestaurantIdentity(approved, candidate) : false;
  });
  if (!pack) return { status: "missing", fingerprint: null };
  const fingerprint = fingerprintBrandPack(pack);
  // The approval has to cover the evidence that is on the project right
  // now, not merely some evidence for the same restaurant.
  if (forThisRestaurant.some(({ proposedActionRef }) => approvalMatchesBrandPack(proposedActionRef, fingerprint))) {
    return { status: "approved", fingerprint };
  }
  // "Changed" is only honest when the founder approved *some* evidence
  // version for this restaurant and it is not the one on the project now.
  // An approval that recorded no version at all covers no evidence, and
  // saying otherwise would tell the founder something untrue.
  const approvedAnyVersion = forThisRestaurant.some(({ proposedActionRef }) => {
    const reference = proposedActionRef && typeof proposedActionRef === "object" && !Array.isArray(proposedActionRef)
      ? (proposedActionRef as Record<string, unknown>).brandPackFingerprint
      : null;
    return typeof reference === "string" && reference.length > 0;
  });
  return { status: approvedAnyVersion ? "changed" : "missing", fingerprint: null };
}

/** The plain-language reason a prospect build is not allowed to start. */
function evidenceApprovalProblem(approval: EvidenceApproval, restaurantName: string): string | null {
  if (approval.status === "approved") return null;
  return approval.status === "changed"
    ? `The evidence on this project has changed since you approved it, so Jarvis stopped rather than building ${restaurantName}'s site from something you have not seen. Approve the new evidence to continue.`
    : `This prospect has no approved evidence version recorded, so there is nothing Jarvis is allowed to build ${restaurantName}'s site from. Ask Jarvis to gather the evidence again and approve it.`;
}

async function founderApprovedThisDelivery(db: Db, organizationId: string, projectId: string, commitSha: string): Promise<boolean> {
  const approvals = await approvedActionEvidence(db, organizationId, projectId, DEMO_APPROVAL_ACTION);
  return approvals.some(({ proposedActionRef }) => approvalMatchesDelivery(proposedActionRef, commitSha));
}

function renderWebsiteArtifact(delivery: EngineeringDeliveryResult, projectName: string): string {
  const website = delivery.website!;
  const built = demoIsBuilt(delivery);
  return [
    `# Concept website — ${projectName}`,
    "",
    built
      ? "**Status: built.** The route, the commit and the preview all exist and were checked."
      : `**Status: not finished.** The work is committed, but ${missingDemoParts(delivery).join(" and ")} ${missingDemoParts(delivery).length === 1 ? "is" : "are"} still missing, so this is not yet a demo anyone can look at.`,
    "",
    `- Preview: ${delivery.previewUrl ?? previewExplanation(delivery)}`,
    `- Route: \`${delivery.previewPath ?? "unknown"}\``,
    `- Pages: ${website.pages.map((page) => `\`${page}\``).join(", ")}`,
    `- Pull request: ${delivery.pullRequestUrl}`,
    `- Commit: \`${delivery.commitSha}\``,
    `- Generation attempts: ${website.attempts}`,
    "",
    website.designRationale,
    "",
    "## Quality assurance",
    "",
    "Deterministic checks ran before the branch was pushed: the preview route exists as source, every page renders,",
    "every navigation target resolves, no placeholder copy survives, every visible fact resolves to approved evidence,",
    "and no service is offered that the evidence does not establish.",
    "",
    "```text",
    website.qaSummary,
    "```",
    "",
    "## Evidence behind every visible fact",
    "",
    website.evidenceTable,
    "",
    "## Remaining uncertainty",
    "",
    website.uncertainties.length > 0 ? website.uncertainties.map((item) => `- ${item}`).join("\n") : "- None beyond the research's own caveats.",
    "",
    "## Generated files",
    "",
    website.files.map((file) => `- \`${file}\``).join("\n"),
  ].join("\n");
}

function previewExplanation(delivery: EngineeringDeliveryResult): string {
  return delivery.previewStatus === "unavailable"
    ? "No preview could be read from GitHub while Jarvis was waiting; the deployment may have failed."
    : "The preview deployment had not appeared yet when Jarvis last looked.";
}

/**
 * One delivery produces two records: the engineering result the rest of
 * the workflow parses, and — for a prospect demo — a founder-readable
 * account of the design, its evidence and what is still unverified.
 */
async function recordEngineeringDelivery(db: Db, input: {
  organizationId: string;
  executionId: string;
  projectId: string;
  taskId: string;
  agentId: string;
  actorUserId: string;
  projectKey: string;
  projectName: string;
  delivery: EngineeringDeliveryResult;
  title: string;
}) {
  const { delivery } = input;
  const artifact = await createArtifact(db, {
    organizationId: input.organizationId,
    executionId: input.executionId,
    artifactType: "report",
    // The website report is written as its own artifact; keeping it out of
    // the embedded marker keeps the machine-readable payload small enough
    // to survive the artifact size limit intact.
    content: `${engineeringMarker({ ...delivery, website: undefined })}\n\n# ${input.title}\n\n- Pull request: ${delivery.pullRequestUrl}\n- Branch: \`${delivery.branch}\`\n- Commit: \`${delivery.commitSha}\`\n- Preview: ${delivery.previewUrl ?? "Pending Vercel check"}\n\n## Validation and implementation report\n\n${delivery.validationSummary}`.slice(0, 20_000),
    title: `${input.title} — ${input.projectKey}`,
    actorAgentId: input.agentId,
  });
  if (delivery.website) {
    const websiteArtifact = await createArtifact(db, {
      organizationId: input.organizationId,
      executionId: input.executionId,
      artifactType: "report",
      title: `Concept website — ${input.projectKey}`,
      content: renderWebsiteArtifact(delivery, input.projectName).slice(0, 20_000),
      actorAgentId: input.agentId,
    });
    await linkArtifactToEntity(db, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      artifactId: websiteArtifact.id,
      linkedEntityType: "task",
      linkedEntityId: input.taskId,
      actorUserId: input.actorUserId,
    });
  }
  return artifact;
}

const ARTIFACT_LIMIT = 20_000;

/**
 * Artifact content is capped, and the embedded markers are what later
 * stages parse. Keeping the marker whole and trimming the prose instead
 * means a long report degrades into a shorter report rather than into
 * evidence the pipeline can no longer read.
 */
function withMarker(marker: string, body: string): string {
  if (marker.length + 2 >= ARTIFACT_LIMIT) {
    throw new Error("The recorded evidence is too large to store on one project artifact");
  }
  return `${marker}\n\n${body}`.slice(0, ARTIFACT_LIMIT);
}

type ProjectContextArtifact = { title: string; content: string | null; artifactType: string; createdAt: Date };

/**
 * Keep the newest durable evidence when a project's shared memory reaches
 * the prompt limit. Cutting the first 60k characters kept the oldest work
 * and could hide a newly collected evidence pack, allowing an older pack
 * to look current. Whole recent artifacts are preferred so embedded
 * approval markers are never split merely to retain stale prose.
 */
export function composeProjectContext(projectBrief: string, artifactRows: ProjectContextArtifact[], limit = 60_000): string {
  const separator = "\n\n---\n\n";
  const brief = projectBrief.slice(0, Math.min(12_000, limit));
  const selected: string[] = [];
  let remaining = Math.max(0, limit - brief.length - (brief ? separator.length : 0));

  for (let index = artifactRows.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const row = artifactRows[index]!;
    const block = `# ${row.title} (${row.artifactType})\n\n${row.content ?? ""}`;
    const cost = block.length + (selected.length > 0 ? separator.length : 0);
    if (cost <= remaining) {
      selected.unshift(block);
      remaining -= cost;
      continue;
    }
    // If the newest artifact alone is unusually large, retain its beginning:
    // machine-readable markers are deliberately stored before prose.
    if (selected.length === 0) selected.unshift(block.slice(0, remaining));
  }

  return [brief, ...selected].filter(Boolean).join(separator).slice(0, limit);
}

async function projectContext(db: Db, organizationId: string, projectId: string): Promise<string> {
  const [projectRows, artifactRows] = await Promise.all([
    db
      .select({ name: projects.name, description: projects.description, objective: projects.objective })
      .from(projects)
      .where(and(eq(projects.organizationId, organizationId), eq(projects.id, projectId))),
    db
      .select({ title: agentArtifacts.title, content: agentArtifacts.content, artifactType: agentArtifacts.artifactType, createdAt: agentArtifacts.createdAt })
      .from(projectArtifactLinks)
      .innerJoin(agentArtifacts, eq(agentArtifacts.id, projectArtifactLinks.artifactId))
      .where(and(eq(projectArtifactLinks.organizationId, organizationId), eq(projectArtifactLinks.projectId, projectId)))
      // Oldest first, so the *last* embedded marker in the shared context
      // is the most recent one. Every parser here reads the last marker,
      // and unordered rows would make "the current evidence" a coin toss
      // once a revision has produced a second one.
      .orderBy(asc(agentArtifacts.createdAt)),
  ]);
  const project = projectRows[0];
  const projectBrief = project
    ? `# ${project.name} — project brief\n\n${project.description ?? "No project description recorded."}${project.objective ? `\n\n## Objective\n\n${project.objective}` : ""}`
    : "";
  return composeProjectContext(projectBrief, artifactRows);
}

async function latestEngineeringResult(db: Db, organizationId: string, projectId: string, createdAfter?: Date | null): Promise<EngineeringDeliveryResult | null> {
  const rows = await db
    .select({ content: agentArtifacts.content, createdAt: agentArtifacts.createdAt })
    .from(projectArtifactLinks)
    .innerJoin(agentArtifacts, eq(agentArtifacts.id, projectArtifactLinks.artifactId))
    .where(and(eq(projectArtifactLinks.organizationId, organizationId), eq(projectArtifactLinks.projectId, projectId)));
  for (const row of rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    if (createdAfter && row.createdAt <= createdAfter) continue;
    const parsed = parseEngineeringResult(row.content);
    if (parsed) return parsed;
  }
  return null;
}

async function makeTextArtifact(db: Db, input: { organizationId: string; executionId: string; agentId: string; projectContext: string; goal: string; successCriteria: string; title: string; modelRole: "planning" | "review" }) {
  const agent = await resolveAgentById(db, input.agentId);
  if (!agent) throw new Error("assigned employee is unavailable");
  const identity = getAgentOfficeIdentity(agent);
  const result = await generateText({
    ...getOfficeGenerationConfig(input.modelRole),
    system: `You are the ${identity.title} at LYNQ. Produce the actual project deliverable. Be concrete, testable, and decision-oriented. Use prior project artifacts as shared memory. State missing evidence honestly. Do not claim external actions occurred unless context proves them. Return polished Markdown only.`,
    prompt: JSON.stringify({ goal: input.goal, successCriteria: input.successCriteria, sharedProjectContext: input.projectContext, requestedSections: ["Executive summary", "Scope and decisions", "Acceptance criteria", "Deliverable", "Dependencies and risks", "Handoff"] }),
  });
  if (!result.text.trim()) throw new Error("Office employee produced an empty deliverable");
  return createArtifact(db, { organizationId: input.organizationId, executionId: input.executionId, artifactType: "report", title: input.title, content: result.text.trim().slice(0, 20_000), actorAgentId: input.agentId });
}

async function dispatchReadyTasks(db: Db, input: { organizationId: string; projectId: string; actorUserId: string }) {
  const tasks = await listTasks(db, { organizationId: input.organizationId, projectId: input.projectId, actorUserId: input.actorUserId });
  for (const task of tasks) {
    if (task.status !== "backlog") continue;
    const metadata = parseOfficeTaskMetadata(task.description);
    if (!metadata) continue;
    if ((await getUnresolvedBlockingTaskIds(db, input.organizationId, task.id)).length > 0) continue;
    const ready = await transitionTaskStatus(db, { organizationId: input.organizationId, taskId: task.id, toStatus: "ready", expectedRevision: task.revision, actorUserId: input.actorUserId });
    const agent = await resolveAgentById(db, metadata.agentId);
    if (!agent) throw new Error("A queued Office employee is unavailable");
    await launchAgentForTask(db, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      taskId: task.id,
      agentId: agent.id,
      goal: metadata.goal,
      successCriteria: metadata.successCriteria,
      failureCriteria: "Stop and escalate if permissions, evidence, isolation, validation, or repository scope cannot be proven.",
      allowedDomains: getDirectiveDomains(agent),
      priority: 90,
      actorUserId: input.actorUserId,
    });
    await transitionTaskStatus(db, { organizationId: input.organizationId, taskId: task.id, toStatus: "in_progress", expectedRevision: ready.revision, actorUserId: input.actorUserId });
  }
}

async function completeTaskAndAdvance(db: Db, input: { organizationId: string; projectId: string; taskId: string; actorUserId: string }) {
  let task = await resolveTaskById(db, input.organizationId, input.taskId);
  if (task.status === "in_progress") task = await transitionTaskStatus(db, { organizationId: input.organizationId, taskId: task.id, toStatus: "review", expectedRevision: task.revision, actorUserId: input.actorUserId });
  if (task.status === "review") await transitionTaskStatus(db, { organizationId: input.organizationId, taskId: task.id, toStatus: "completed", expectedRevision: task.revision, actorUserId: input.actorUserId });
  await dispatchReadyTasks(db, input);
}

export async function continueOfficeDirectiveExecution(db: Db, input: { organizationId: string; executionId: string }) {
  let execution = await resolveExecutionById(db, input.organizationId, input.executionId);
  if (!execution.assignedAgentId) throw new Error("office execution has no assigned employee");
  if (execution.status === "completed") return execution;
  if (["failed", "cancelled", "archived"].includes(execution.status)) throw new Error(`office execution is terminal: ${execution.status}`);
  const agent = await resolveAgentById(db, execution.assignedAgentId);
  if (!agent || agent.organizationId !== input.organizationId) throw new Error("assigned employee is unavailable");
  const [link] = await db.select({ projectId: projectExecutionLinks.projectId, taskId: projectExecutionLinks.taskId }).from(projectExecutionLinks).where(and(eq(projectExecutionLinks.executionId, execution.id), eq(projectExecutionLinks.organizationId, input.organizationId)));
  if (!link) throw new Error("office execution is not linked to a project task");
  const task = await resolveTaskById(db, input.organizationId, link.taskId);
  const metadata = parseOfficeTaskMetadata(task.description);
  if (!metadata) throw new Error("office task metadata is missing");
  const [projectRow] = await db.select({ name: projects.name, projectKey: projects.projectKey, objective: projects.objective }).from(projects).where(and(eq(projects.id, link.projectId), eq(projects.organizationId, input.organizationId)));
  if (!projectRow) throw new Error("office project is unavailable");

  const approvals = await db.select().from(agentApprovalRequests).where(and(eq(agentApprovalRequests.organizationId, input.organizationId), eq(agentApprovalRequests.executionId, execution.id)));
  const latestApproval = approvals.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (metadata.stage === "research" && latestApproval?.status === "approved") {
    const plan = await getLatestPlan(db, execution.id);
    if (!plan) throw new Error("office execution has no durable plan");
    const statuses = new Map((await getPlanSteps(db, plan.id)).map((step) => [step.stepNumber, step.status]));
    if (!completed(4, statuses)) await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId: plan.id, stepNumber: 4, actorAgentId: agent.id });
    await completeTaskAndAdvance(db, { organizationId: input.organizationId, projectId: link.projectId, taskId: link.taskId, actorUserId: execution.ownerUserId });
    await advanceIfAt(db, input.organizationId, execution.id, agent.id, "executing", "verifying");
    execution = await resolveExecutionById(db, input.organizationId, execution.id);
    return execution.status === "verifying" ? completeExecution(db, { organizationId: input.organizationId, executionId: execution.id, actorAgentId: agent.id }) : execution;
  }
  if (metadata.stage === "research" && latestApproval?.status === "pending") return execution;
  if (metadata.stage === "outreach" && latestApproval?.status === "approved") {
    const artifact = (await listArtifactsForExecution(db, input.organizationId, execution.id)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const outreach = parseRestaurantOutreach(artifact?.content ?? null);
    if (!outreach) throw new Error("approved outreach message evidence is missing");
    await queueMessageAfterRecordedApproval(db, { organizationId: input.organizationId, messageId: outreach.messageId, actorUserId: execution.ownerUserId });
    const plan = await getLatestPlan(db, execution.id);
    if (!plan) throw new Error("office execution has no durable plan");
    const statuses = new Map((await getPlanSteps(db, plan.id)).map((step) => [step.stepNumber, step.status]));
    if (!completed(4, statuses)) await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId: plan.id, stepNumber: 4, actorAgentId: agent.id });
    await completeTaskAndAdvance(db, { organizationId: input.organizationId, projectId: link.projectId, taskId: link.taskId, actorUserId: execution.ownerUserId });
    const project = await resolveProjectById(db, input.organizationId, link.projectId);
    const tasks = await listTasks(db, { organizationId: input.organizationId, projectId: link.projectId, actorUserId: execution.ownerUserId });
    if (project.status === "active" && tasks.every((item) => item.status === "completed")) {
      await transitionProjectStatus(db, { organizationId: input.organizationId, projectId: project.id, toStatus: "completed", expectedRevision: project.revision, actorUserId: execution.ownerUserId });
    }
    await advanceIfAt(db, input.organizationId, execution.id, agent.id, "executing", "verifying");
    execution = await resolveExecutionById(db, input.organizationId, execution.id);
    return execution.status === "verifying" ? completeExecution(db, { organizationId: input.organizationId, executionId: execution.id, actorAgentId: agent.id }) : execution;
  }
  if (metadata.stage === "outreach" && latestApproval?.status === "pending") return execution;
  if (metadata.stage === "qa" && latestApproval?.status === "approved") {
    const plan = await getLatestPlan(db, execution.id);
    if (!plan) throw new Error("office execution has no durable plan");
    const statuses = new Map((await getPlanSteps(db, plan.id)).map((step) => [step.stepNumber, step.status]));
    if (!completed(4, statuses)) await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId: plan.id, stepNumber: 4, actorAgentId: agent.id });
    await completeTaskAndAdvance(db, { organizationId: input.organizationId, projectId: link.projectId, taskId: link.taskId, actorUserId: execution.ownerUserId });
    const project = await resolveProjectById(db, input.organizationId, link.projectId);
    const tasks = await listTasks(db, { organizationId: input.organizationId, projectId: link.projectId, actorUserId: execution.ownerUserId });
    if (project.status === "active" && tasks.every((item) => item.status === "completed")) {
      await transitionProjectStatus(db, { organizationId: input.organizationId, projectId: project.id, toStatus: "completed", expectedRevision: project.revision, actorUserId: execution.ownerUserId });
    }
    await advanceIfAt(db, input.organizationId, execution.id, agent.id, "executing", "verifying");
    execution = await resolveExecutionById(db, input.organizationId, execution.id);
    return execution.status === "verifying" ? completeExecution(db, { organizationId: input.organizationId, executionId: execution.id, actorAgentId: agent.id }) : execution;
  }
  if (metadata.stage === "qa" && latestApproval?.status === "pending") return execution;

  const plan = await getLatestPlan(db, execution.id);
  if (!plan) throw new Error("office execution has no durable plan");
  const statuses = new Map((await getPlanSteps(db, plan.id)).map((step) => [step.stepNumber, step.status]));
  await advanceIfAt(db, input.organizationId, execution.id, agent.id, "planning", "reasoning");
  if (!completed(1, statuses)) await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId: plan.id, stepNumber: 1, actorAgentId: agent.id });
  await advanceIfAt(db, input.organizationId, execution.id, agent.id, "reasoning", "executing");

  let artifact = (await listArtifactsForExecution(db, input.organizationId, execution.id)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const context = await projectContext(db, input.organizationId, link.projectId);
  if (!artifact || latestApproval?.status === "revision_requested" || latestApproval?.status === "rejected") {
    if (metadata.stage === "research") {
      const research = await researchRestaurantProspects({
        directive: projectRow.objective ?? metadata.goal,
        revisionNote: latestApproval?.decisionNote,
      });
      // Evidence is gathered in the same stage that chose the prospect, so
      // the founder approves the restaurant and the material it would be
      // built from in one decision rather than two disconnected ones.
      const collection = await collectRestaurantBrandPack({ candidate: research.recommendation });
      const evidenceArtifact = await createArtifact(db, {
        organizationId: input.organizationId,
        executionId: execution.id,
        artifactType: "report",
        title: `Brand evidence — ${projectRow.projectKey}`,
        // The pack is its own artifact so neither payload can push the
        // other past the artifact size limit and be silently truncated.
        content: withMarker(brandPackMarker(collection.pack), `# Approved brand evidence — ${research.recommendation.name}\n\nEvidence version \`${fingerprintBrandPack(collection.pack)}\`, collected ${collection.pack.collectedAt}. This is the machine-readable record the website factory builds from; the founder-facing review is on the approval above.`),
        actorAgentId: agent.id,
      });
      await linkArtifactToEntity(db, { organizationId: input.organizationId, projectId: link.projectId, artifactId: evidenceArtifact.id, linkedEntityType: "task", linkedEntityId: link.taskId, actorUserId: execution.ownerUserId });
      artifact = await createArtifact(db, {
        organizationId: input.organizationId,
        executionId: execution.id,
        artifactType: "report",
        title: `Restaurant recommendation — ${projectRow.projectKey}`,
        content: withMarker(
          restaurantResearchMarker(research),
          `${renderProspectApproval({
            restaurantName: research.recommendation.name,
            pack: collection.pack,
            collectionFailure: collection.failure,
            researchUncertainty: research.uncertainty,
          })}\n\n---\n\n${renderRestaurantResearch(research)}`,
        ),
        actorAgentId: agent.id,
      });
    } else if (metadata.stage === "outreach") {
      const research = parseRestaurantResearch(context);
      if (!research) throw new Error("Outreach is waiting for the founder-approved restaurant research");
      if (!research.recommendation.email) throw new Error("Outreach is waiting for a verified public business email for the approved restaurant");
      const delivery = await latestEngineeringResult(db, input.organizationId, link.projectId);
      if (!delivery) throw new Error("Outreach is waiting for the verified Engineering demo");
      // Founder approval gate two: the founder must have accepted the built
      // demo before a single word of outreach is drafted for it.
      if (!(await founderApprovedThisDelivery(db, input.organizationId, link.projectId, delivery.commitSha))) {
        throw new Error("Outreach is waiting for the founder to approve the built demo");
      }
      const inspected = await inspectEngineeringDelivery(delivery);
      if (!inspected.previewUrl) throw new Error("Outreach is waiting for a working preview link. Nothing is sent while the demo the email would point at cannot be opened.");
      let connections = await listConnectionsForUser(db, { organizationId: input.organizationId, actorUserId: execution.ownerUserId });
      let connection = connections.find((item) => item.provider === "resend" && item.integrationType === "email" && item.status === "connected");
      if (!connection) {
        await ensureEnvironmentManagedResendConnection(db, { organizationId: input.organizationId, actorUserId: execution.ownerUserId });
        connections = await listConnectionsForUser(db, { organizationId: input.organizationId, actorUserId: execution.ownerUserId });
        connection = connections.find((item) => item.provider === "resend" && item.integrationType === "email" && item.status === "connected");
      }
      if (!connection) throw new Error("Outreach is ready, but a verified Resend email connection is not connected in Communications");
      const conversation = await findOrCreateConversation(db, {
        organizationId: input.organizationId,
        channel: "email",
        integrationConnectionId: connection.id,
        externalThreadId: `jarvis-restaurant:${link.projectId}`,
        assignedUserId: execution.ownerUserId,
        actorUserId: execution.ownerUserId,
      });
      const draft = await draftRestaurantOutreach({ candidate: research.recommendation, previewUrl: inspected.previewUrl, founderDirective: projectRow.objective ?? metadata.goal });
      const message = await createDraftMessage(db, {
        organizationId: input.organizationId,
        conversationId: conversation.id,
        channel: "email",
        integrationConnectionId: connection.id,
        senderReference: process.env.LYNQ_OUTREACH_FROM_EMAIL ?? process.env.RESEND_FROM_ADDRESS ?? "Mustafa from LYNQ <mustafa@lynq.build>",
        recipientReference: research.recommendation.email,
        subject: draft.subject,
        bodyText: draft.body,
        idempotencyKey: `jarvis-restaurant-outreach:${link.projectId}:${latestApproval?.id ?? "initial"}`,
        createdByAgentId: agent.id,
        actorUserId: execution.ownerUserId,
      });
      artifact = await createArtifact(db, {
        organizationId: input.organizationId,
        executionId: execution.id,
        artifactType: "draft_text",
        title: `Outreach approval — ${research.recommendation.name}`,
        content: `${restaurantOutreachMarker({ messageId: message.id, recipient: research.recommendation.email, previewUrl: inspected.previewUrl })}\n\n# Outreach draft\n\n- Restaurant: ${research.recommendation.name}\n- Recipient: ${research.recommendation.email}\n- Preview: ${inspected.previewUrl}\n- Provider: Resend (not sent yet)\n\n## Subject\n\n${draft.subject}\n\n## Message\n\n${draft.body}\n\n## Decision\n\nApprove to queue exactly this one email. Request changes to rewrite it. Stop to cancel the outreach.`.slice(0, 20_000),
        actorAgentId: agent.id,
      });
    } else if (metadata.stage === "engineering") {
      const objective = projectRow.objective ?? metadata.goal;
      // Founder approval gate one: a prospect's website is never built
      // before the founder has approved that prospect.
      const prospect = parseRestaurantResearch(context);
      if (prospect && !(await founderApprovedThisRestaurant(db, input.organizationId, link.projectId, prospect.recommendation))) {
        throw new Error(`Engineering is waiting for the founder to approve the restaurant (${prospect.recommendation.name}) before any website is built`);
      }
      const evidenceApproval = prospect
        ? await approvedBrandPackFingerprint(db, input.organizationId, link.projectId, prospect.recommendation, context)
        : null;
      if (prospect && evidenceApproval) {
        const problem = evidenceApprovalProblem(evidenceApproval, prospect.recommendation.name);
        if (problem) throw new Error(problem);
      }
      const delivery = await executeEngineeringDelivery({
        executionId: execution.id,
        organizationId: input.organizationId,
        projectId: link.projectId,
        projectKey: projectRow.projectKey,
        projectName: projectRow.name,
        objective,
        acceptanceCriteria: metadata.successCriteria,
        sharedContext: context,
        approvedBrandPackFingerprint: evidenceApproval?.fingerprint ?? null,
      });
      artifact = await recordEngineeringDelivery(db, {
        organizationId: input.organizationId,
        executionId: execution.id,
        projectId: link.projectId,
        taskId: link.taskId,
        agentId: agent.id,
        actorUserId: execution.ownerUserId,
        projectKey: projectRow.projectKey,
        projectName: projectRow.name,
        delivery,
        title: "Engineering delivery",
      });
    } else if (metadata.stage === "qa") {
      let delivery = latestApproval?.status === "revision_requested"
        ? await latestEngineeringResult(db, input.organizationId, link.projectId, latestApproval.decidedAt)
        : await latestEngineeringResult(db, input.organizationId, link.projectId);
      if (!delivery && latestApproval?.status === "revision_requested") {
        const objective = `${projectRow.objective ?? metadata.goal}\n\nFounder requested these changes: ${latestApproval.decisionNote || "Revise the implementation based on the founder review."}`;
        const revisionProspect = parseRestaurantResearch(context);
        if (revisionProspect && !(await founderApprovedThisRestaurant(db, input.organizationId, link.projectId, revisionProspect.recommendation))) {
          throw new Error(`A revision is waiting for the founder to approve the restaurant (${revisionProspect.recommendation.name}) before any website is rebuilt`);
        }
        const revisionEvidence = revisionProspect
          ? await approvedBrandPackFingerprint(db, input.organizationId, link.projectId, revisionProspect.recommendation, context)
          : null;
        if (revisionProspect && revisionEvidence) {
          const problem = evidenceApprovalProblem(revisionEvidence, revisionProspect.recommendation.name);
          if (problem) throw new Error(problem);
        }
        delivery = await executeEngineeringDelivery({
          executionId: execution.id,
          organizationId: input.organizationId,
          projectId: link.projectId,
          projectKey: projectRow.projectKey,
          projectName: projectRow.name,
          objective,
          acceptanceCriteria: metadata.successCriteria,
          sharedContext: context,
          approvedBrandPackFingerprint: revisionEvidence?.fingerprint ?? null,
        });
        const revisionArtifact = await recordEngineeringDelivery(db, {
          organizationId: input.organizationId,
          executionId: execution.id,
          projectId: link.projectId,
          taskId: link.taskId,
          agentId: agent.id,
          actorUserId: execution.ownerUserId,
          projectKey: projectRow.projectKey,
          projectName: projectRow.name,
          delivery,
          title: "Revised engineering delivery",
        });
        await linkArtifactToEntity(db, { organizationId: input.organizationId, projectId: link.projectId, artifactId: revisionArtifact.id, linkedEntityType: "task", linkedEntityId: link.taskId, actorUserId: execution.ownerUserId });
      }
      if (!delivery) throw new Error("QA is waiting for an Engineering pull request");
      const inspected = await inspectEngineeringDelivery(delivery);
      if (!inspected.previewUrl) throw new Error("Quality Assurance is waiting for the preview link. The branch and commit exist, but no preview deployment has appeared yet, so there is nothing for you to open and approve.");
      const review = await generateText({
        ...getOfficeGenerationConfig("review"),
        system: "You are LYNQ's independent Quality Assurance Lead. Review the supplied implementation evidence against the objective and acceptance criteria. Be concise and factual. Identify defects or missing evidence; never claim checks passed unless the evidence says so. Return polished Markdown with Verdict, Acceptance criteria, Risks, and Founder recommendation.",
        prompt: JSON.stringify({ objective: projectRow.objective ?? metadata.goal, acceptanceCriteria: metadata.successCriteria, implementation: delivery.agentSummary, automatedChecks: inspected.checks, previewUrl: inspected.previewUrl, pullRequestUrl: delivery.pullRequestUrl }),
      });
      artifact = await createArtifact(db, {
        organizationId: input.organizationId,
        executionId: execution.id,
        artifactType: "report",
        title: `Founder review — ${projectRow.projectKey}`,
        content: `# Founder review\n\n${review.text.trim()}\n\n## What was built\n\n${delivery.agentSummary}\n\n## Review links\n\n- Preview: ${inspected.previewUrl}\n- Pull request: ${delivery.pullRequestUrl}\n- Commit: \`${delivery.commitSha}\`\n\n## Automated checks\n\n\`\`\`text\n${inspected.checks}\n\`\`\`\n\n## Decision\n\nApprove the verified preview to continue the planned handoff, or request changes to send it through another isolated Engineering revision.`,
        actorAgentId: agent.id,
      });
    } else {
      artifact = await makeTextArtifact(db, { organizationId: input.organizationId, executionId: execution.id, agentId: agent.id, projectContext: context, goal: metadata.goal, successCriteria: metadata.successCriteria, title: `${getAgentOfficeIdentity(agent).title} — ${projectRow.projectKey}`, modelRole: metadata.stage === "product" ? "planning" : "review" });
    }
  }

  if (!artifact?.content) throw new Error("office deliverable has no reviewable content");
  for (const stepNumber of [2, 3] as const) {
    if (!completed(stepNumber, statuses)) await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId: plan.id, stepNumber, actorAgentId: agent.id });
  }
  const existingLinks = await listArtifactLinks(db, { organizationId: input.organizationId, projectId: link.projectId, linkedEntityType: "task", linkedEntityId: link.taskId, actorUserId: execution.ownerUserId });
  if (!existingLinks.some((item) => item.artifactId === artifact!.id)) await linkArtifactToEntity(db, { organizationId: input.organizationId, projectId: link.projectId, artifactId: artifact.id, linkedEntityType: "task", linkedEntityId: link.taskId, actorUserId: execution.ownerUserId });

  if (metadata.stage === "research") {
    // The approval names the exact evidence version it covers. Gathering
    // evidence again produces a different version, which this approval
    // then provably does not cover.
    const approvedPack = parseBrandPack(await projectContext(db, input.organizationId, link.projectId));
    const fingerprint = approvedPack ? fingerprintBrandPack(approvedPack) : null;
    const approvalSummary = `Review Jarvis's cited restaurant recommendation for ${projectRow.name}${approvedPack ? ` — ${approvalSummaryLine(approvedPack)}` : " — no public evidence could be gathered"}. Approving accepts this restaurant and this exact evidence; requesting changes researches another restaurant. No outreach has been sent.`;
    const approval = await requestApproval(db, { organizationId: input.organizationId, executionId: execution.id, requestedAction: RESTAURANT_PROSPECT_APPROVAL_ACTION, summary: approvalSummary.slice(0, 1000), riskLevel: "medium", artifactId: artifact.id, proposedActionRef: { projectId: link.projectId, taskId: link.taskId, brandPackFingerprint: fingerprint }, actorAgentId: agent.id });
    await linkApprovalToEntity(db, { organizationId: input.organizationId, projectId: link.projectId, approvalRequestId: approval.request.id, linkedEntityType: "task", linkedEntityId: link.taskId, actorUserId: execution.ownerUserId });
    await notifyJarvisApprovalNeeded(db, { organizationId: input.organizationId, ownerUserId: execution.ownerUserId, projectId: link.projectId, projectName: projectRow.name, summary: approvalSummary });
    return approval.execution;
  }

  if (metadata.stage === "outreach") {
    const outreach = parseRestaurantOutreach(artifact.content);
    if (!outreach) throw new Error("outreach message evidence is missing");
    const approvalSummary = `Review the exact restaurant email and preview link for ${projectRow.name}. Approving queues one Resend email; requesting changes rewrites it. Nothing has been sent yet.`;
    const approval = await requestApproval(db, { organizationId: input.organizationId, executionId: execution.id, requestedAction: RESTAURANT_OUTREACH_APPROVAL_ACTION, summary: approvalSummary, riskLevel: "high", artifactId: artifact.id, proposedActionRef: { projectId: link.projectId, taskId: link.taskId, messageId: outreach.messageId }, actorAgentId: agent.id });
    await attachMessageToExistingApproval(db, { organizationId: input.organizationId, messageId: outreach.messageId, approvalRequestId: approval.request.id, actorUserId: execution.ownerUserId });
    await linkApprovalToEntity(db, { organizationId: input.organizationId, projectId: link.projectId, approvalRequestId: approval.request.id, linkedEntityType: "task", linkedEntityId: link.taskId, actorUserId: execution.ownerUserId });
    await notifyJarvisApprovalNeeded(db, { organizationId: input.organizationId, ownerUserId: execution.ownerUserId, projectId: link.projectId, projectName: projectRow.name, summary: approvalSummary });
    return approval.execution;
  }

  if (metadata.stage === "qa") {
    const reviewedDelivery = await latestEngineeringResult(db, input.organizationId, link.projectId);
    if (!reviewedDelivery) throw new Error("QA approval is missing the Engineering delivery it reviewed");
    const approvalSummary = `Review the preview and pull request for ${projectRow.name}. Approving accepts this demo and continues any remaining planned handoff; requesting changes starts another isolated Engineering revision.`;
    const approval = await requestApproval(db, { organizationId: input.organizationId, executionId: execution.id, requestedAction: DEMO_APPROVAL_ACTION, summary: approvalSummary, riskLevel: "high", artifactId: artifact.id, proposedActionRef: { projectId: link.projectId, taskId: link.taskId, commitSha: reviewedDelivery.commitSha, previewPath: reviewedDelivery.previewPath }, actorAgentId: agent.id });
    await linkApprovalToEntity(db, { organizationId: input.organizationId, projectId: link.projectId, approvalRequestId: approval.request.id, linkedEntityType: "task", linkedEntityId: link.taskId, actorUserId: execution.ownerUserId });
    await notifyJarvisApprovalNeeded(db, { organizationId: input.organizationId, ownerUserId: execution.ownerUserId, projectId: link.projectId, projectName: projectRow.name, summary: approvalSummary });
    return approval.execution;
  }

  await completeTaskAndAdvance(db, { organizationId: input.organizationId, projectId: link.projectId, taskId: link.taskId, actorUserId: execution.ownerUserId });
  if (!completed(4, statuses)) await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId: plan.id, stepNumber: 4, actorAgentId: agent.id });
  await advanceIfAt(db, input.organizationId, execution.id, agent.id, "executing", "verifying");
  execution = await resolveExecutionById(db, input.organizationId, execution.id);
  return execution.status === "verifying" ? completeExecution(db, { organizationId: input.organizationId, executionId: execution.id, actorAgentId: agent.id }) : execution;
}
