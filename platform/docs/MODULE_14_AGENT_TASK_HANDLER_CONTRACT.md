# Module 14 — Agent Task Handler Contract

Companion to `MODULE_14_GENERIC_AGENT_EXECUTION.md`. Full detail on the bounded interface and in-code typed registry every agent task type implements, and why it is safe (no executable prompts, no dynamic code loading).

## Why this exists

Before Module 14, the Workflow Engine's `agent_execution` node type was a single hardcoded function (`executeAgentExecutionNode` in `engine.ts`) that always called `createKnowledgeAnalystTask` regardless of which agent a node's `agentId` actually pointed at — Company Knowledge Analyst was the only real driver. Module 13's own Sales agents (Lead Research Assistant, Opportunity Summary Assistant) could not be launched from a workflow node at all; they were only reachable through their own direct-launch APIs. `MODULE_13_SALES_OS.md`/`sales-os/templates.ts` documented this as a known architectural limitation.

Module 14 replaces the hardcoded call with a bounded, typed contract (`src/lib/agent-runtime/task-handlers.ts`) and an in-code registry — never a data-driven or free-text dispatch.

## The contract

```ts
export const AGENT_TASK_TYPES = ["company_knowledge_report", "sales_lead_research", "sales_opportunity_summary"] as const;
export type AgentTaskType = (typeof AGENT_TASK_TYPES)[number];

export interface AgentTaskHandler {
  taskType: AgentTaskType;
  expectedAgentName: string;
  isAgentEligible(agent: Agent): boolean;
  launch(db, input: AgentTaskLaunchInput): Promise<{ runtimeExecutionId: string }>;
  resolveState(db, input: { organizationId; runtimeExecutionId }): Promise<AgentTaskState>;
}
```

- **`taskType`** — one of a closed, in-code string union. There is no path from workflow node `configuration` JSON to an arbitrary handler: `resolveAgentTaskHandler(taskType)` looks the string up in a `Map` populated only by `registerAgentTaskHandler` calls made at module import time by each agent's own file (`knowledge-analyst.ts`, `sales-os/agents.ts`). An unrecognized string returns `null`, never a dynamic `import()`/`require()`.
- **`expectedAgentName`** — the one real agent identity this task type is bound to today (`isAgentEligible` checks `agent.name === expectedAgentName && agent.lifecycleStage !== "retired"`). This is deliberately the smallest robust eligibility model the spec asked for — "prefer static config over a new table." There is no general multi-agent-per-task-type marketplace; adding a second agent for an existing task type, or a genuinely dynamic eligibility rule, is a reviewed code change to a handler file, not a data change.
- **`launch`** — starts the real Agent Runtime work and returns immediately with a `runtimeExecutionId`. It never marks anything complete itself. `taskInput` is the node's own resolved `inputMapping` output (`resolveMapping`, `mapping.ts`) — the exact same bounded, arbitrary-code-free mapping mechanism every other node type already uses for its own inputs. A handler's `launch` never receives or evaluates raw workflow `configuration` as instructions; it only reads a few specific, typed fields out of `taskInput` (e.g. `topic`, `leadId`) and throws `InvalidAgentTaskInputError` if a required one is missing or the wrong type.
- **`resolveState`** — a live check of the linked Runtime execution's own current status (never a cached/local value), returning one of three states: `{status:"pending"}`, `{status:"succeeded", evidence}`, `{status:"failed", failureClassification, message}`.

## The bounded completion evidence

```ts
export interface AgentTaskCompletionEvidence {
  runtimeExecutionId: string;
  taskType: AgentTaskType;
  status: "succeeded";
  primaryArtifactId: string | null;
  artifactIds: string[];
  structuredOutput: Record<string, unknown>;
  completedAt: Date;
}
```

References only — an artifact id, not its content. `structuredOutput` is a small, schema-shaped summary (`{ reportArtifactId }` for every handler that exists today), never raw agent reasoning, a full report body, or anything requiring re-validation against an external schema at read time; the shape is fixed by the handler itself, not by workflow configuration.

All three current handlers share one implementation of this evidence-gathering step, `resolveReportArtifactTaskState` (reads the linked `agent_executions` row, and — if `completed` — the newest `report`-type artifact on it). This is shared code, not a shared registry entry: each handler still registers itself independently under its own `taskType`, and a future handler with a different completion shape is free not to call this helper at all.

## Registered handlers

| Task type | Agent | Registered in | Launch calls |
|---|---|---|---|
| `company_knowledge_report` | Company Knowledge Analyst | `src/lib/agents/knowledge-analyst.ts` | `createKnowledgeAnalystTask` (asynchronous — enqueues a real `execution_run` job) |
| `sales_lead_research` | Lead Research Assistant | `src/lib/sales-os/agents.ts` | `createLeadResearchTask` (synchronous — completes within the call) |
| `sales_opportunity_summary` | Opportunity Summary Assistant | `src/lib/sales-os/agents.ts` | `createOpportunitySummaryTask` (synchronous) |

Registration is a top-level side effect of importing each file — `engine.ts` and `graph-validation.ts` both `import "@/lib/agents/knowledge-analyst"` and `import "@/lib/sales-os/agents"` (no bindings used) specifically to guarantee registration has happened before either resolves a handler. `task-handlers.ts` itself imports neither of them — the dependency direction is one-way (agent files → registry), never the reverse, so there is no circular import between the registry and the handlers it holds.

## What this explicitly is not

- Not a prompt template system — no handler ever assembles a string that gets sent to an LLM as "the agent's instructions" derived from workflow configuration.
- Not a plugin/extension system loaded from configuration, a database row, or an environment variable — every handler is a compiled TypeScript file in this repository.
- Not a general "call any function by name" dispatcher — `AgentTaskLaunchInput`/`AgentTaskCompletionEvidence` are the only two shapes that cross the boundary, both fully typed.

## Update (LYNQ Marketing OS Core, Module 15, now complete)

`AGENT_TASK_TYPES` (`src/lib/agent-runtime/task-types.ts`, the client-safe array this doc's contract snippet draws from) gained three more values, each registered in `src/lib/marketing-os/agents.ts` following the identical pattern the table below already established — no change to the contract, the registry mechanism, or `resolveAgentTaskHandler` itself:

| Task type | Agent | Registered in | Launch calls |
|---|---|---|---|
| `marketing_campaign_brief` | Campaign Brief Assistant | `src/lib/marketing-os/agents.ts` | `createCampaignBriefTask` (synchronous) |
| `marketing_content_draft` | Content Draft Assistant | `src/lib/marketing-os/agents.ts` | `createContentDraftTask` (synchronous) |
| `marketing_campaign_summary` | Campaign Summary Assistant | `src/lib/marketing-os/agents.ts` | `createCampaignSummaryTask` (synchronous) |

All three share `resolveReportArtifactTaskState` for `resolveState`, the same evidence-gathering helper the three pre-existing handlers use. `engine.ts`/`graph-validation.ts` additionally `import "@/lib/marketing-os/agents"` for its registration side effect, following the exact one-way (agent files → registry) import direction already established — no circular import introduced. This is the first module to exercise the registry with a task type whose owning module (Marketing OS) was built entirely after Module 14 shipped, confirming the contract needed zero changes to accommodate a new, unrelated domain. See `MODULE_15_MARKETING_OS.md` and `MODULE_15_MARKETING_PLAYBOOKS_AND_AGENTS.md`.

## Update (LYNQ Communications & Integrations Core, Module 16, now complete)

Two more task types, both owned by `src/lib/communications-os/agents.ts`: `communications_draft_reply` (`createDraftReplyTask`) and `communications_draft_follow_up` (`createDraftFollowUpTask`), both registered to the same single agent identity (Communications Assistant) — the contract's `expectedAgentName` binding is per-TASK-TYPE, not per-agent, so one agent legitimately owns multiple task types where Sales/Marketing OS each used a distinct agent per type. Neither reuses `resolveReportArtifactTaskState` — both produce a `draft_text` artifact (a message draft, not a "report"), so this module adds its own local `resolveDraftArtifactTaskState` counterpart, filtering for `artifactType === "draft_text"` instead. This is a deliberate divergence from the shared helper (rather than mislabeling the artifact type just to fit it, the choice Marketing OS's own `marketing_content_draft` handler made) — see `MODULE_16_INTEGRATION_ADAPTERS.md` for the full reasoning. The contract itself needed zero changes. See `MODULE_16_COMMUNICATIONS_CORE.md`.

## See also

- `MODULE_14_GENERIC_AGENT_EXECUTION.md` — how the Workflow Engine's `agent_execution` node uses this contract, including the legacy-configuration compatibility path and concurrency hardening.
- `MODULE_7_AGENT_RUNTIME_CORE.md` — the underlying execution lifecycle every handler drives through (`createExecution → assignExecution → startExecution → advanceExecution → completeExecution`), unchanged by this module.
