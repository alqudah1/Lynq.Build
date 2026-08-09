# Module 14 — Generic Agent Execution

Companion to `MODULE_14_AGENT_TASK_HANDLER_CONTRACT.md`. Full detail on how the Workflow Engine's `agent_execution` node became generic, its legacy-configuration compatibility path, and its concurrency/recovery hardening.

## Node configuration — new shape, old rows untouched

```ts
export const agentExecutionNodeConfigSchema = z.object({
  agentId: z.string().uuid(),
  agentTaskType: z.enum(AGENT_TASK_TYPES),
  expectedOutputKey: z.string().trim().min(1).max(100).optional(),
}).strict();
```

Field-level input mapping (`topic`, `allowedDomains`, `leadId`, `opportunityId`, …) is **not** part of `configuration` — it uses the node's own pre-existing `inputMapping` column and `resolveMapping` resolver, exactly like `tool_invocation`'s `toolInput` already does. This was a deliberate simplification versus the pre-Module-14 shape (which embedded `topic`/`allowedDomains` directly in `configuration`): one mapping mechanism, not two.

Node configuration is validated by `nodeConfigSchemaFor` at **draft-create/update time** (`nodes.ts`) and at **publish time** (`graph-validation.ts`) — never re-validated at execution time. This is why the schema could change shape without a migration or a rewrite of historically-published rows: a node published before Module 14 keeps whatever configuration it was validated against when it was published, and the engine reads `node.configuration` directly (`as` cast, not re-parsed) when it actually runs.

## Legacy shape resolution

A published node with no `agentTaskType` field (`{agentId, topic, allowedDomains, maxResults?}`, the exact pre-Module-14 shape) is detected and resolved to `company_knowledge_report` at execution time, in both places that read `node.configuration`:

- `resolveAgentExecutionNodeTask` (used by the "launch" path, `executeAgentExecutionNode`)
- `resolveAsyncNodeState`'s `agent_execution` case (used by the "consume the result" path)

Both apply the exact same override rule the original hardcoded executor had: a mapped workflow input (`mappedInput.topic`/`mappedInput.allowedDomains`) overrides the static legacy config value when present, never the reverse. Legacy rows are never rewritten in place — this is purely an execution-time interpretation, not a migration. Verified directly: `module14-agent-execution.integration.test.ts`'s "a legacy-shape node … still resolves … and completes" test creates a node the normal way, then overwrites `configuration` directly with the old shape (simulating a historically-published row) and runs it end-to-end.

`src/lib/workflows/templates.ts`'s two starter templates (`KNOWLEDGE_REPORT_TEMPLATE`, `PROJECT_RESEARCH_TASK_TEMPLATE`) were updated to the new shape, since they create fresh nodes on every seed call — new nodes always use the current schema. `allowedDomains`'s literal default (`["identity"]`) required widening `mappingSourceSchema`'s `literal` variant to accept a bounded string array (`z.array(z.string()).max(20)`), still a plain JSON value, never an expression.

## Execution — launch and consume

`executeAgentExecutionNode` (`engine.ts`):

1. Resolves `{agentTaskType, taskInput, expectedOutputKey}` (legacy-aware, above).
2. Resolves the handler via `resolveAgentTaskHandler(agentTaskType)` — throws `UnsupportedAgentDriverError` if no handler is registered for that type (a static, in-code condition; see the task handler contract doc for why this can never be reached by a dynamically-supplied type).
3. Resolves and validates the referenced agent (`resolveAgentById` — must exist in this org and not be retired) and its eligibility for this task type (`handler.isAgentEligible`). Both are returned as an ordinary `NodeResolution` failure (`permission_revoked` / `agent_task_ineligible`), not thrown — consistent with how `tool_invocation`/`approval`/`artifact_transform` already handle a retired agent, and routed through the normal `handleNodeFailure`/retry-policy path.
4. Calls `handler.launch(...)`, then immediately calls `handler.resolveState(...)` once. Some handlers (the two Sales agents) complete synchronously within `launch` itself, so this lets the node resolve to `"succeeded"` inline within the same dispatch, exactly like `tool_invocation`/`artifact_transform` already do — never forcing a needless extra poll cycle for a task type that never actually waits on anything external. Company Knowledge Analyst tasks remain genuinely asynchronous (`createKnowledgeAnalystTask` enqueues a real `execution_run` job) and resolve to `"waiting"` here.
5. Node output is built by `buildAgentTaskNodeOutput`, preserving the exact pre-Module-14 shape (`{runtimeExecutionId, reportArtifactId}`) plus the rest of the handler's `structuredOutput`, so no existing template/mapping consumer of a `company_knowledge_report` node's output needed to change. If `expectedOutputKey` is set and absent from the result, the node fails deterministically (`invalid_agent_task_output`) rather than silently succeeding with a gap.

`resolveAsyncNodeState`'s `agent_execution` case mirrors steps 1–2 and 5, then calls `handler.resolveState` — the same live-check-never-cached-status discipline every other case in this function already follows.

## The Knowledge Analyst notification gap this module also closed

A `company_knowledge_report` node's Runtime execution completes through the **separate** `execution_run` job queue (`worker.ts`), not the `workflow_node_execute`/`workflow_continue` jobs that dispatched it. Nothing previously nudged the linked workflow once that job finished — the workflow would only resume once the periodic `workflow_reconcile` sweep noticed it was stuck (`RUNTIME_CONFIG.executionStuckThresholdSeconds`, 10 minutes by default). This pre-existing gap had no test coverage before Module 14 (no `agent_execution` end-to-end test existed at all). `worker.ts`'s `runExecutionJob` now calls `notifyLinkedWorkflowNodeIfAny` after every Knowledge Analyst continuation — a cheap "is a `workflow_node_executions` row actually linked to this Runtime execution?" check, then `enqueueWorkflowContinuation` — the exact same pattern `notifyApprovalDecided`/`notifyProjectTaskChanged` already use for approval/project_task nodes. A safe no-op for the overwhelming majority of Knowledge Analyst tasks, which are launched directly and never linked to any workflow node.

## Concurrency hardening — the claim step

**The race:** `workflow_node_execute` jobs are leased (Module 9), which normally guarantees at most one active worker per job. But a lease is time-based, not a true mutual-exclusion lock — a worker that stalls past its lease timeout can have its lease reclaimed by a second worker while the first is still mid-flight. Before Module 14, `dispatchAsyncNode` had no atomic "claim" step before its side-effecting work: two such workers could both pass `executeWorkflowNodeJob`'s `status === "pending"` check and both call `handler.launch()`, launching two real Runtime executions for the same logical node attempt.

**The fix:** `dispatchAsyncNode`'s `agent_execution` case performs a compare-and-set claim — `transitionNodeExecution(..., fromStatuses: ["pending"], toStatus: "running")` — **before** calling `executeAgentExecutionNode`. Only one concurrent caller can win this atomic `UPDATE ... WHERE status = 'pending' AND revision = expected`; the loser gets `null` back and returns `{resolution: "waiting"}` immediately, a safe no-op that never launches anything and never touches the node execution row again. The winner's claimed (updated-revision) `nodeExecution` reference is what every subsequent transition in `dispatchAsyncNode` uses — including on failure.

**A subtlety this required fixing:** if `dispatchAsyncNode` reassigns its local `nodeExecution` after a successful claim, the caller (`executeWorkflowNodeJob`) still held the original, now-stale reference. Calling `handleNodeFailure` with that stale reference would silently no-op its own revision-guarded CAS (wrong expected revision) while still proceeding to record events and decide retry/failure for the whole workflow — leaving the individual node execution row stuck at `"running"` forever, undetected. The fix: `dispatchAsyncNode` now calls `handleNodeFailure` itself, using its own (possibly-claimed) `nodeExecution` reference, instead of returning a "failed" result for the caller to act on with a reference that may already be stale. This is a general fix (applies to every async node type, not just `agent_execution`) made because the new claim step exposed it, not a broader redesign of node dispatch.

## Recovery — a claimed-but-never-launched attempt

If a process claims an attempt (`"running"`, no `runtimeExecutionId`) and then genuinely dies before `handler.launch()` ever persists that id, the row is stuck: it isn't `"pending"` (so `workflow_node_execute`'s own idempotency key can never re-arm it) and it isn't `"waiting"` (so `checkAndContinueWorkflow` ignores it). `reconcileWorkflows` (`reconciliation.ts`) gained a new pass for exactly this state: a `"running"` node execution with `runtimeExecutionId IS NULL`, past the same staleness threshold used elsewhere in this file, whose parent workflow execution has no active job, is failed (`failureClassification: "claim_timeout"`) and a fresh attempt is opened — mirroring exactly what `handleNodeFailure`'s own retry path already does for any other node failure, just reached from reconciliation instead of a synchronous throw. Verified directly in `module14-agent-execution.integration.test.ts`.

## What was deliberately left alone

- `worker.ts`'s `execution_run`/`execution_resume`/`execution_retry` job dispatch remains hardcoded to `continueKnowledgeAnalystExecution` — still correct, since Knowledge Analyst is the only task type that runs asynchronously through that job queue; both Sales agent tasks complete synchronously within their own `launch()` call and never enqueue that job type.
- Sales OS's own starter workflow templates (`sales-os/templates.ts`) still use only `human_task`/`approval` nodes, not `agent_execution` — the limitation that made that necessary is resolved, but retrofitting those specific templates was not part of what this module was scoped to do.
- No new database table or migration — the generic contract, registry, and claim step are all in-code/existing-column changes.
