import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { agents } from "@/db/schema";
import { registerAgent, resolveAgentById, type Agent } from "./agents";
import { advanceAgentLifecycleStage, changeAgentPermissionLevel } from "./lifecycle";
import { createBrainPermissionGrant } from "@/lib/brain/permissions";
import { resolveEffectiveBrainCapabilitiesForAgent } from "@/lib/brain/authz";
import { createExecution, getExecutionForUser, resolveExecutionById, type AgentExecution, type AgentExecutionStatus } from "@/lib/agent-runtime/executions";
import { assignExecution, startExecution, advanceExecution, completeExecution } from "@/lib/agent-runtime/lifecycle";
import { createPlan, completePlanStep, getLatestPlan, getPlanSteps } from "@/lib/agent-runtime/plans";
import { listArtifactsForExecution } from "@/lib/agent-runtime/artifacts";
import { createCheckpoint, listCheckpointsForExecution } from "@/lib/agent-runtime/checkpoints";
import { recordAuditEvent } from "@/lib/audit";
import { invokeTool } from "@/lib/tools/invocation";
import { enqueueJob, type RuntimeJob } from "@/lib/runtime/queue";
import type { BrainSearchOutput } from "@/lib/tools/implementations/brain-search";
import type { AgentKnowledgeContext } from "./brain-reads";
import type { KnowledgeDomain } from "@/lib/brain/knowledge-items";
import { DomainRuleViolationError, TenantResourceNotFoundError } from "@/lib/authz/errors";
import { registerAgentTaskHandler, resolveReportArtifactTaskState, InvalidAgentTaskInputError } from "@/lib/agent-runtime/task-handlers";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type RawSql = NeonQueryFunction<false, false>;

/**
 * ============================================================================
 * "Company Knowledge Analyst" — the first working agent, Module 8 Part 3
 * ============================================================================
 *
 * Registered and moved through the existing Agent Registry lifecycle
 * exactly like any other agent (§2's `idea → ... → deployment` sequence,
 * then a separate, explicit permission increase per §5) — nothing here is
 * a new agent-creation path. Its ONE task type — deterministic,
 * evidence-bounded knowledge reporting — is orchestrated entirely through
 * the real Agent Runtime Core (Module 7) and the real `invokeTool` engine
 * (Module 8 Part 1); no service call here ever marks an execution complete
 * or fabricates a tool result.
 */
export const KNOWLEDGE_ANALYST_NAME = "Company Knowledge Analyst";

export class NoAccessibleDomainsError extends DomainRuleViolationError {
  readonly reason = "no_accessible_domains";
  constructor() {
    super("agent holds no readable Brain grant for any of the task's requested domains");
    this.name = "NoAccessibleDomainsError";
  }
}

export interface SeedKnowledgeAnalystInput {
  organizationId: string;
  humanOwnerUserId: string;
  allowedDomains: KnowledgeDomain[];
  actorUserId: string;
}

/**
 * Idempotent — safe to call on every deploy/test-setup. Registers the
 * agent (starts at `idea`, `assistant` permission REQUESTED only),
 * advances it through every lifecycle stage to `deployment` (§2's forward
 * -only sequence, one call per stage — `approval` structurally forces the
 * permission level down to `observer` first), then raises it back to
 * `assistant` as its OWN separate, explicit approval (§5) — never implied
 * by deployment itself. No approve/archive/purge/permission-management
 * capability and no external tools are granted anywhere in this file — the
 * agent's only capabilities come from the narrow Brain `read` grants
 * issued below, one per requested domain.
 */
export async function seedKnowledgeAnalystAgent(db: Db, input: SeedKnowledgeAnalystInput): Promise<Agent> {
  const [existingRow] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.organizationId, input.organizationId), eq(agents.name, KNOWLEDGE_ANALYST_NAME)));

  let agent: Agent;
  if (existingRow) {
    agent = (await resolveAgentById(db, existingRow.id))!;
  } else {
    agent = await registerAgent(db, {
      organizationId: input.organizationId,
      name: KNOWLEDGE_ANALYST_NAME,
      department: "research_and_strategy",
      purpose: "Answer bounded company-knowledge questions using only Brain knowledge it is permitted to read, producing a cited report artifact as objective evidence of completion.",
      responsibilities: "Given a topic or question, search the Brain within its granted domains, retrieve citation-ready context for the knowledge it finds, and assemble a structured report of findings, contradictions, and missing information.",
      goals: "Every claim in its report is mechanically traceable to a specific Brain knowledge item version it was permitted to read during that same execution.",
      inputs: "A bounded topic/question, optional workspace, a maximum result count, and a requested report format.",
      outputs: "One `report` artifact per task: title, summary, key findings, supporting references with citations, contradictions found, and missing information.",
      successCriteria: "The report artifact is created, every citation in it matches an actual brain.search/brain.get_context tool result recorded on the same execution, and the execution reaches `completed` through the real Runtime completion gate.",
      failureCriteria: "It cannot access any permitted Brain knowledge relevant to the question, or a tool call it depends on fails with a non-retryable error.",
      retirementCriteria: "Superseded by a general-purpose research agent, or the organization no longer needs company-knowledge reporting.",
      humanOwnerUserId: input.humanOwnerUserId,
      permissionLevel: "assistant",
      actorUserId: input.actorUserId,
    });

    for (const toStage of ["specification", "development", "testing", "approval", "deployment"] as const) {
      await advanceAgentLifecycleStage(db, { organizationId: input.organizationId, agentId: agent.id, toStage, actorUserId: input.actorUserId });
    }

    await changeAgentPermissionLevel(db, {
      organizationId: input.organizationId,
      agentId: agent.id,
      newPermissionLevel: "assistant",
      reason: "First working agent (Module 8) — 'assistant' is the minimum permission level artifact.create_report requires.",
      actorUserId: input.actorUserId,
    });
  }

  const existingCapableDomains = new Set<KnowledgeDomain>();
  for (const domain of input.allowedDomains) {
    const capabilities = await resolveEffectiveBrainCapabilitiesForAgent(db, { organizationId: input.organizationId, domain, workspaceId: null }, agent.id);
    if (capabilities.has("read")) {
      existingCapableDomains.add(domain);
      continue;
    }
    await createBrainPermissionGrant(db, {
      organizationId: input.organizationId,
      domain,
      grantee: { type: "agent", agentId: agent.id },
      capability: "read",
      reason: "Company Knowledge Analyst — narrow read-only grant for its first working task (Module 8).",
      actorUserId: input.actorUserId,
    });
  }

  return (await resolveAgentById(db, agent.id))!;
}

const PLAN_STEP_VALIDATE = 1;
const PLAN_STEP_SEARCH = 2;
const PLAN_STEP_RETRIEVE_CONTEXT = 3;
const PLAN_STEP_ASSEMBLE_EVIDENCE = 4;
const PLAN_STEP_CREATE_ARTIFACT = 5;
const PLAN_STEP_VERIFY = 6;

export interface KnowledgeAnalystTaskResult {
  execution: AgentExecution;
  artifactId: string;
  reportOutput: { artifactId: string; reusedFromPriorAttempt: boolean };
}

/**
 * ============================================================================
 * Module 9 — creation (fast, synchronous) vs. continuation (resumable)
 * ============================================================================
 *
 * Splits what used to be one all-in-one `runKnowledgeAnalystTask` call
 * into exactly the two phases Module 9 asks for: `createKnowledgeAnalystTask`
 * does only `createExecution → assign → start → advance(planning) →
 * createPlan → enqueue`, none of which ever touches the Brain or a tool —
 * fast enough to run inside an HTTP request and return immediately.
 * `continueKnowledgeAnalystExecution` is everything after that (the
 * actual search/retrieve/assemble/report work), and is safe to call
 * *more than once* for the same execution: every tool call already
 * carries its own Module 8 idempotency key, `completePlanStep` is only
 * invoked for a step not already `completed`, and every status
 * transition is guarded by re-checking the execution's OWN current
 * status first — so calling this function again after a crash resumes
 * from wherever the execution actually got to, never re-doing a
 * confirmed side effect and never re-creating a second execution. This
 * is what makes it safe for a worker (`src/lib/runtime/worker.ts`) to
 * drive via job claims instead of one held-open HTTP request.
 *
 * The task's own original parameters (`topic`, `maxResults`) are
 * recovered from the very first checkpoint written at creation time —
 * `allowedDomains`/`workspaceId` are already durable on the execution
 * row itself (`domainsRequested`/`workspaceId`), so no new schema was
 * needed to make this resumable.
 */

const PLAN_STEPS = [
  "Validate task input and confirm accessible Brain domains",
  "Search Brain for relevant knowledge items",
  "Retrieve citation-ready context for the top results",
  "Assemble evidence, contradictions, and missing information",
  "Create report artifact",
  "Verify completion evidence",
];

export interface CreateKnowledgeAnalystTaskInput {
  organizationId: string;
  workspaceId?: string | null;
  ownerUserId: string;
  agentId: string;
  topic: string;
  allowedDomains: KnowledgeDomain[];
  maxResults?: number;
  actorUserId: string;
}

/**
 * Creates the execution and its plan, enqueues the one job that will
 * drive it the rest of the way, and returns immediately — "creating a
 * task may: create the execution, create the plan, enqueue the
 * execution job, return the execution ID immediately" (task's own exact
 * words). No tool call, no Brain access, nothing that could fail on a
 * transient provider issue happens in this function.
 */
export async function createKnowledgeAnalystTask(db: Db, input: CreateKnowledgeAnalystTaskInput): Promise<{ execution: AgentExecution; job: RuntimeJob }> {
  const workspaceId = input.workspaceId ?? null;
  const maxResults = input.maxResults ?? 10;

  const execution = await createExecution(db, {
    organizationId: input.organizationId,
    workspaceId,
    ownerUserId: input.ownerUserId,
    goal: `Create a company knowledge report for: "${input.topic}"`,
    successCriteria: "A report artifact exists whose citations are drawn entirely from this execution's own brain.search/brain.get_context tool results.",
    failureCriteria: "No permitted Brain knowledge could be found, or a required tool call failed with a non-retryable error.",
    domainsRequested: input.allowedDomains,
    actorUserId: input.actorUserId,
  });

  await recordAuditEvent(db, {
    eventType: "knowledge_analyst_task_started",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    targetType: "agent_execution",
    targetId: execution.id,
    metadata: { topic: input.topic, allowedDomains: input.allowedDomains },
  });

  await assignExecution(db, { organizationId: input.organizationId, executionId: execution.id, assignedAgentId: input.agentId, actorUserId: input.actorUserId });
  await startExecution(db, { organizationId: input.organizationId, executionId: execution.id, actorUserId: input.actorUserId });
  // The row `advanceExecution` returns reflects the execution's actual
  // current state (`planning`) — the ORIGINAL `execution` variable above
  // is a stale snapshot from before any of these transitions and must
  // never be what this function returns.
  const planningExecution = await advanceExecution(db, { organizationId: input.organizationId, executionId: execution.id, toStatus: "planning", actorAgentId: input.agentId });

  await createPlan(db, { organizationId: input.organizationId, executionId: execution.id, actorAgentId: input.agentId, steps: PLAN_STEPS });

  // The one durable place this task's own original parameters live —
  // `resolveKnowledgeAnalystTaskParams` reads this same checkpoint back.
  await createCheckpoint(db, {
    organizationId: input.organizationId,
    executionId: execution.id,
    statusAtCheckpoint: "planning",
    actorAgentId: input.agentId,
    safeStateSummary: { topic: input.topic, maxResults },
  });

  const job = await enqueueJob(db, {
    organizationId: input.organizationId,
    workspaceId,
    jobType: "execution_run",
    executionId: execution.id,
    idempotencyKey: `exec:${execution.id}`,
  });

  return { execution: planningExecution, job };
}

/** Guarded transition — a safe no-op if the execution has already moved past `from` (a resumed call re-entering after the transition already happened), and a real `InvalidExecutionTransitionError` if it's in some OTHER, unexpected state. */
async function ensureAdvanced(db: Db, organizationId: string, executionId: string, agentId: string, from: AgentExecutionStatus, to: AgentExecutionStatus): Promise<void> {
  const current = await resolveExecutionById(db, organizationId, executionId);
  if (current.status === from) {
    await advanceExecution(db, { organizationId, executionId, toStatus: to, actorAgentId: agentId });
  }
}

/**
 * Everything after task creation — resumable from any point. Called
 * directly, in-process, by the synchronous convenience wrapper below;
 * called repeatedly, across possibly-many process lifetimes, by the
 * worker (`worker.ts`) for the asynchronous path.
 */
export async function continueKnowledgeAnalystExecution(db: Db, rawSql: RawSql, input: { organizationId: string; executionId: string }): Promise<KnowledgeAnalystTaskResult> {
  const organizationId = input.organizationId;
  const executionId = input.executionId;

  const initial = await resolveExecutionById(db, organizationId, executionId);
  const agentId = initial.assignedAgentId;
  if (!agentId) throw new Error("execution has no assigned agent — cannot continue");

  if (initial.status === "completed") {
    const artifacts = await listArtifactsForExecution(db, organizationId, executionId);
    const report = artifacts.filter((a) => a.artifactType === "report").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (!report) throw new Error("execution is completed but has no report artifact — inconsistent state, requires human review");
    return { execution: initial, artifactId: report.id, reportOutput: { artifactId: report.id, reusedFromPriorAttempt: true } };
  }
  if (initial.status === "failed" || initial.status === "cancelled" || initial.status === "archived") {
    throw new Error(`execution is "${initial.status}" — cannot continue a terminal, non-completed execution`);
  }

  const workspaceId = initial.workspaceId;
  const allowedDomains = initial.domainsRequested;

  // `startExecution` (Module 7) already writes its own checkpoint at
  // `gathering_context` before this task's own "planning" checkpoint
  // exists — so the origin checkpoint is identified by its distinctive
  // `topic` field, never assumed to be "whichever one is oldest."
  const checkpoints = await listCheckpointsForExecution(db, organizationId, executionId);
  const origin = checkpoints.find((c) => typeof c.safeStateSummary?.topic === "string");
  if (!origin) throw new Error("no origin checkpoint found — task parameters cannot be recovered");
  const { topic, maxResults } = origin.safeStateSummary as { topic: string; maxResults: number };

  const plan = await getLatestPlan(db, executionId);
  if (!plan) throw new Error("no plan found for this execution");
  const steps = await getPlanSteps(db, plan.id);
  const stepStatus = (n: number) => steps.find((s) => s.stepNumber === n)?.status;

  await ensureAdvanced(db, organizationId, executionId, agentId, "planning", "reasoning");

  // Step 1 — validate: narrow the task's requested domains down to the
  // ones the agent can currently actually read (live check, never the
  // Execution Context snapshot) — refuses outright if none are readable,
  // rather than silently searching zero domains and reporting "nothing
  // found." Re-validated on every resume, never trusted from a prior run.
  const accessibleDomains: KnowledgeDomain[] = [];
  for (const domain of allowedDomains) {
    const capabilities = await resolveEffectiveBrainCapabilitiesForAgent(db, { organizationId, domain, workspaceId }, agentId);
    if (capabilities.has("read")) accessibleDomains.push(domain);
  }
  if (accessibleDomains.length === 0) {
    throw new NoAccessibleDomainsError();
  }
  if (stepStatus(PLAN_STEP_VALIDATE) !== "completed") {
    await completePlanStep(db, { organizationId, executionId, planId: plan.id, stepNumber: PLAN_STEP_VALIDATE, actorAgentId: agentId });
  }

  await ensureAdvanced(db, organizationId, executionId, agentId, "reasoning", "executing");

  // Step 2 — search, one call per accessible domain. Safe to repeat:
  // `invokeTool` returns the cached result for a domain already searched
  // in a prior attempt under this execution, never re-running the query.
  const searchResults: BrainSearchOutput["results"] = [];
  for (const domain of accessibleDomains) {
    const result = await invokeTool(db, rawSql, {
      organizationId,
      executionId,
      agentId,
      toolKey: "brain.search",
      idempotencyKey: `search:${domain}`,
      toolInput: { query: topic, domain, workspaceId, limit: maxResults },
    });
    searchResults.push(...(result.output as BrainSearchOutput).results);
  }
  const boundedResults = searchResults.slice(0, maxResults);
  if (stepStatus(PLAN_STEP_SEARCH) !== "completed") {
    await completePlanStep(db, { organizationId, executionId, planId: plan.id, stepNumber: PLAN_STEP_SEARCH, actorAgentId: agentId });
  }

  // Step 3 — retrieve citation-ready context for each result found.
  const contexts: AgentKnowledgeContext[] = [];
  for (const item of boundedResults) {
    const result = await invokeTool(db, rawSql, {
      organizationId,
      executionId,
      agentId,
      toolKey: "brain.get_context",
      idempotencyKey: `context:${item.knowledgeItemId}:${item.versionNumber}`,
      toolInput: { knowledgeItemId: item.knowledgeItemId, versionNumber: item.versionNumber },
    });
    contexts.push(result.output as AgentKnowledgeContext);
  }
  if (stepStatus(PLAN_STEP_RETRIEVE_CONTEXT) !== "completed") {
    await completePlanStep(db, { organizationId, executionId, planId: plan.id, stepNumber: PLAN_STEP_RETRIEVE_CONTEXT, actorAgentId: agentId });
  }

  // Step 4 — assemble evidence. Deterministic formatting only: every
  // citation is mechanically derived from `contexts`, i.e. from actual
  // tool results recorded on this execution, never invented. Contradiction
  // detection requires semantic comparison this deterministic executor
  // does not attempt — the section is always present, honestly left
  // empty rather than faked.
  const citations = contexts.map((c) => ({
    knowledgeItemId: c.id,
    versionNumber: c.versionNumber,
    title: c.title,
    domain: c.domain,
    sourceType: c.source?.sourceType ?? null,
    trustTier: c.trust.trustTier,
    retrievedAt: c.retrievedAt.toISOString(),
  }));
  const keyFindings = contexts.map((c) => `${c.title} (domain: ${c.domain}, v${c.versionNumber}): ${c.content.slice(0, 280)}`);
  const missingInformation = accessibleDomains
    .filter((domain) => !contexts.some((c) => c.domain === domain))
    .map((domain) => `No accessible knowledge found in domain "${domain}" for this topic.`);
  const summary =
    contexts.length > 0
      ? `Found ${contexts.length} relevant knowledge item(s) across domain(s): ${accessibleDomains.join(", ")}.`
      : `No relevant knowledge was found in the domain(s) this task was permitted to read: ${accessibleDomains.join(", ")}.`;
  if (stepStatus(PLAN_STEP_ASSEMBLE_EVIDENCE) !== "completed") {
    await completePlanStep(db, { organizationId, executionId, planId: plan.id, stepNumber: PLAN_STEP_ASSEMBLE_EVIDENCE, actorAgentId: agentId });
  }

  // Step 5 — create the report artifact (the objective completion
  // evidence itself). Idempotency-keyed constant — a resumed call
  // reuses the exact same artifact rather than creating a second one.
  const reportResult = await invokeTool(db, rawSql, {
    organizationId,
    executionId,
    agentId,
    toolKey: "artifact.create_report",
    idempotencyKey: "report",
    toolInput: {
      title: `Company Knowledge Report: ${topic}`.slice(0, 300),
      summary,
      keyFindings,
      supportingReferences: citations,
      contradictions: [],
      missingInformation,
    },
  });
  const reportOutput = reportResult.output as { artifactId: string; reusedFromPriorAttempt: boolean };

  if (stepStatus(PLAN_STEP_CREATE_ARTIFACT) !== "completed") {
    await recordAuditEvent(db, {
      eventType: "knowledge_analyst_report_created",
      organizationId,
      actorAgentId: agentId,
      targetType: "agent_artifact",
      targetId: reportOutput.artifactId,
      metadata: { executionId, citationCount: citations.length },
    });
    await completePlanStep(db, { organizationId, executionId, planId: plan.id, stepNumber: PLAN_STEP_CREATE_ARTIFACT, actorAgentId: agentId });
  }

  await ensureAdvanced(db, organizationId, executionId, agentId, "executing", "verifying");

  // Step 6 — verify completion evidence: the artifact this execution's
  // own success criteria requires actually exists.
  if (!reportOutput.artifactId) {
    throw new Error("report artifact was not created — refusing to verify completion");
  }
  if (stepStatus(PLAN_STEP_VERIFY) !== "completed") {
    await completePlanStep(db, { organizationId, executionId, planId: plan.id, stepNumber: PLAN_STEP_VERIFY, actorAgentId: agentId });
  }

  // The 7th, terminal step — completeExecution's own evidence gate now
  // finds every one of the 6 plan steps above resolved and allows the
  // transition. No direct status write, no test-helper shortcut. Guarded
  // the same way as every other transition above — a resumed call after
  // this already succeeded simply skips straight to returning below.
  const current = await resolveExecutionById(db, organizationId, executionId);
  let completed = current;
  if (current.status === "verifying") {
    completed = await completeExecution(db, { organizationId, executionId, actorAgentId: agentId });
    await recordAuditEvent(db, {
      eventType: "knowledge_analyst_task_completed",
      organizationId,
      actorAgentId: agentId,
      targetType: "agent_execution",
      targetId: executionId,
      metadata: { artifactId: reportOutput.artifactId },
    });
  }

  return { execution: completed, artifactId: reportOutput.artifactId, reportOutput };
}

export type RunKnowledgeAnalystTaskInput = CreateKnowledgeAnalystTaskInput;

/**
 * The synchronous convenience path — "keep the existing synchronous path
 * only if required for tests or local development, clearly separated
 * and documented" (task's own instruction). Used by this module's own
 * integration tests and any local-dev caller that wants one call and an
 * immediate final result, with no worker involved. Production task
 * submission goes through `createKnowledgeAnalystTask` (via the
 * `POST .../knowledge-analyst/tasks` route) followed by a real worker
 * calling `continueKnowledgeAnalystExecution` — HTTP request lifetime is
 * never what keeps the execution alive on that path.
 */
export async function runKnowledgeAnalystTask(db: Db, rawSql: RawSql, input: RunKnowledgeAnalystTaskInput): Promise<KnowledgeAnalystTaskResult> {
  const { execution } = await createKnowledgeAnalystTask(db, input);
  return continueKnowledgeAnalystExecution(db, rawSql, { organizationId: input.organizationId, executionId: execution.id });
}

/** Looks up the org's already-seeded Knowledge Analyst by name — routes never auto-seed on request, the same "no silent side effect from a read/start call" discipline the rest of this codebase follows. */
export async function resolveKnowledgeAnalystAgent(db: Db, organizationId: string): Promise<Agent> {
  const [row] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.organizationId, organizationId), eq(agents.name, KNOWLEDGE_ANALYST_NAME)));
  if (!row) throw new TenantResourceNotFoundError();
  return (await resolveAgentById(db, row.id))!;
}

export interface KnowledgeAnalystReportView {
  executionId: string;
  executionStatus: string;
  artifactId: string;
  title: string;
  summary: string;
  keyFindings: string[];
  supportingReferences: Array<{ knowledgeItemId: string; versionNumber: number; title: string; domain: string; sourceType: string | null; trustTier: string | null; retrievedAt: string }>;
  contradictions: string[];
  missingInformation: string[];
  generatedAt: string;
  agentId: string;
}

/** Retrieves the report artifact this task produced, parsed back into structured fields — the exact human-visibility gate every other execution-scoped read uses. */
export async function getKnowledgeAnalystReport(db: Db, input: { organizationId: string; executionId: string; actorUserId: string }): Promise<KnowledgeAnalystReportView> {
  const execution = await getExecutionForUser(db, { organizationId: input.organizationId, executionId: input.executionId, actorUserId: input.actorUserId });

  const artifacts = await listArtifactsForExecution(db, input.organizationId, input.executionId);
  const report = artifacts.filter((a) => a.artifactType === "report").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (!report || !report.content) {
    throw new TenantResourceNotFoundError();
  }

  const parsed = JSON.parse(report.content) as Omit<KnowledgeAnalystReportView, "executionId" | "executionStatus" | "artifactId">;
  return { executionId: execution.id, executionStatus: execution.status, artifactId: report.id, ...parsed };
}

/**
 * Module 14 — registers Company Knowledge Analyst as a generic agent task
 * handler (`company_knowledge_report`) so the Workflow Engine's
 * `agent_execution` node can drive it through the same bounded contract as
 * any other agent task type, instead of a hardcoded direct call. This is
 * additive only: `createKnowledgeAnalystTask`/`continueKnowledgeAnalystExecution`/
 * `runKnowledgeAnalystTask` and the direct-launch API are unchanged and
 * still the canonical way to start a task outside a workflow.
 */
registerAgentTaskHandler({
  taskType: "company_knowledge_report",
  expectedAgentName: KNOWLEDGE_ANALYST_NAME,
  isAgentEligible: (agent) => agent.name === KNOWLEDGE_ANALYST_NAME && agent.lifecycleStage !== "retired",
  async launch(db, input) {
    const topic = typeof input.taskInput.topic === "string" ? input.taskInput.topic : "";
    if (!topic) throw new InvalidAgentTaskInputError("company_knowledge_report", "topic is required");
    const allowedDomains = Array.isArray(input.taskInput.allowedDomains) ? (input.taskInput.allowedDomains as KnowledgeDomain[]) : [];
    if (allowedDomains.length === 0) throw new InvalidAgentTaskInputError("company_knowledge_report", "allowedDomains must include at least one domain");
    const maxResults = typeof input.taskInput.maxResults === "number" ? input.taskInput.maxResults : undefined;

    const { execution } = await createKnowledgeAnalystTask(db as Db, {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      ownerUserId: input.actorUserId,
      agentId: input.agentId,
      topic,
      allowedDomains,
      maxResults,
      actorUserId: input.actorUserId,
    });
    return { runtimeExecutionId: execution.id };
  },
  resolveState: (db, input) => resolveReportArtifactTaskState(db as Db, "company_knowledge_report", input),
});
