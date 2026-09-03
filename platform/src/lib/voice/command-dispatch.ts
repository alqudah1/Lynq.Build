import "server-only";

import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { recordAuditEvent } from "@/lib/audit";
import { createDirectiveProject, DirectivePartiallyCreatedError } from "@/lib/office/directive-intake";
import { toDirectiveInstruction } from "./command-draft";
import { redactLogFields } from "./redaction";
import { phoneAutoDispatchEnabled } from "./phone-config";
import { claimDispatchAttempt, isDispatchInFlight, recordDispatchProject, resolveCommandById, transitionCommand, type JarvisPhoneCommand } from "./call-store";
import { CommandNotRetryableError } from "./errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * What happens after a founder confirms a command on the phone
 * ============================================================================
 *
 * Two paths, and the risk assessment decides which — never the caller, never
 * the assistant, never anything spoken on the call:
 *
 *   requiresApproval = false → a real Office directive is created immediately
 *                              through the SAME `createDirectiveProject` the
 *                              web Command Center uses. Real project, real
 *                              tasks, real Agent Runtime executions.
 *
 *   requiresApproval = true  → NOTHING is created. The command stops at
 *                              `awaiting_approval` and waits for a human
 *                              decision made inside an authenticated session
 *                              (see the command decision route). Only after
 *                              that decision does the same directive path run.
 *
 * Why the gated path is a pre-directive gate rather than an
 * `agent_approval_requests` row: that table is anchored to an
 * `agent_executions` row by a non-null foreign key, and an execution only
 * exists once a directive has been created and an agent launched. Hanging a
 * gate off a fabricated execution would mean starting the very work the gate
 * exists to prevent. So the gate sits one step earlier, and it reuses the
 * pieces that matter — the same owner/admin authority floor
 * `requireApproverAuthority` enforces, the same `recordAuditEvent` trail, the
 * same decide-once revision guard — while every downstream gated action
 * inside the resulting project still hits Agent Runtime's own unmodified
 * approval system exactly as it does today.
 *
 * Failures are explicit. A dispatch that does not produce a project sets
 * `dispatch_state = 'failed'` with a real `failure_code`; it never reports
 * success, and it is never silently retried into a duplicate project.
 */

export type DispatchOutcome =
  | { status: "directive_created"; command: JarvisPhoneCommand; projectId: string; projectName: string; assistantReply: string; launchedCount: number; spoken: string }
  | { status: "awaiting_approval"; command: JarvisPhoneCommand; spoken: string }
  | { status: "already_dispatched"; command: JarvisPhoneCommand; spoken: string }
  | { status: "failed"; command: JarvisPhoneCommand; failureCode: string; spoken: string };

export interface DispatchConfirmedCommandInput {
  organizationId: string;
  founderUserId: string;
  command: JarvisPhoneCommand;
  workspaceId?: string | null;
}

/**
 * Confirms and dispatches. Safe to call twice: the transition is guarded by
 * the revision the command was read at, so a redelivered confirmation finds
 * the row already moved on and reports the EXISTING outcome instead of
 * starting a second project.
 */
export async function dispatchConfirmedCommand(db: Db, input: DispatchConfirmedCommandInput): Promise<DispatchOutcome> {
  const { command } = input;

  if (command.dispatchState !== "awaiting_confirmation") {
    return { status: "already_dispatched", command, spoken: describeExistingState(command) };
  }

  await recordAuditEvent(db, {
    eventType: "jarvis_phone_command_confirmed",
    organizationId: input.organizationId,
    actorUserId: input.founderUserId,
    targetType: "jarvis_phone_command",
    targetId: command.id,
    metadata: { riskLevel: command.riskLevel, requiresApproval: command.requiresApproval },
  });

  if (command.overrideAttempted) {
    // Recorded whether or not it changed the outcome (it never lowers risk —
    // `assessCommandRisk` already raised the level — but an attempt to talk
    // past a safety gate is exactly the thing a later review needs to find).
    await recordAuditEvent(db, {
      eventType: "jarvis_phone_command_override_attempted",
      organizationId: input.organizationId,
      actorUserId: input.founderUserId,
      targetType: "jarvis_phone_command",
      targetId: command.id,
      metadata: { riskLevel: command.riskLevel, honored: false },
    });
  }

  // Auto-dispatch is a separate, off-by-default decision from phone control
  // itself. `assessCommandRisk` is a lexical classifier over speech, and ten
  // adversarial reviews say it should inform an approval screen rather than
  // replace one — see `phoneAutoDispatchEnabled` for the measured numbers.
  //
  // The classifier still runs and its verdict is still recorded: what changes
  // is only whether a `low` verdict is allowed to START anything. When
  // auto-dispatch is off, every phone command stops here, and the risk level,
  // the categories and the reasons ride along to the approval screen.
  const autoDispatch = phoneAutoDispatchEnabled();
  if (command.requiresApproval || !autoDispatch) {
    const gated = await transitionCommand(db, {
      organizationId: input.organizationId,
      commandId: command.id,
      expectedRevision: command.revision,
      confirmationStatus: "confirmed",
      dispatchState: "awaiting_approval",
    });
    if (!gated) {
      // Re-read for the same reason both lost-race branches below do: the
      // caller's row is stale by definition here, and reporting it produced a
      // vague "I already have that one recorded" for a command that is in fact
      // waiting on the Jarvis screen.
      const current = await resolveCommandById(db, { organizationId: input.organizationId, commandId: command.id }).catch(() => command);
      return { status: "already_dispatched", command: current, spoken: describeExistingState(current) };
    }

    await recordAuditEvent(db, {
      eventType: "jarvis_phone_command_gated",
      organizationId: input.organizationId,
      actorUserId: input.founderUserId,
      targetType: "jarvis_phone_command",
      targetId: gated.id,
      metadata: { riskLevel: gated.riskLevel, gatedCategories: gated.gatedCategories },
    });

    return {
      status: "awaiting_approval",
      command: gated,
      spoken: command.requiresApproval
        ? "I've written that up and put it in LYNQ Office for your approval. Nothing has started, and nothing will until you approve it there. It's on the Jarvis screen now."
        : // Honest about WHY: this one is not gated because Jarvis judged it
          // risky, it is gated because nothing said on a call starts work on
          // its own here.
          "I've written that up and put it in LYNQ Office for you to start. It reads as ordinary internal work, but nothing said on a call starts on its own — one tap on the Jarvis screen and the team picks it up.",
    };
  }

  return runDirectiveDispatch(db, {
    organizationId: input.organizationId,
    founderUserId: input.founderUserId,
    command,
    workspaceId: input.workspaceId ?? null,
    confirmationStatus: "confirmed",
  });
}

/**
 * How many times a command may be dispatched before it stops being retryable.
 *
 * Deliberately small, and deliberately a HUMAN retry rather than an automatic
 * one. The common cause of a failed dispatch here is the free model pool being
 * rate-limited, and an automatic retry loop against a rate limit is how you
 * turn one failure into a queue of them. A person pressing "try again" also
 * means someone has actually seen that it failed.
 */
export const MAX_DISPATCH_ATTEMPTS = 5;

/**
 * How long an in-flight dispatch is trusted before another caller may take it
 * over. Comfortably longer than either route that can dispatch — the
 * decision route's `maxDuration` of five minutes and the webhook's of two —
 * so a slow-but-alive dispatch is never stolen from; short enough that a
 * process killed mid-dispatch does not wedge the command for a working day.
 */
export const DISPATCH_LEASE_MS = 10 * 60 * 1000;

/**
 * Retries a dispatch that genuinely failed.
 *
 * Safe with respect to the approval gate by construction: a command can only
 * reach `failed` from a dispatch that was already cleared to run — low risk
 * and confirmed on the call, or gated and since approved by a human. A command
 * still sitting in `awaiting_approval` has never been dispatched, so it can
 * never be retried into existence, and this refuses any state but `failed`.
 */
export async function retryFailedDispatch(
  db: Db,
  input: { organizationId: string; actorUserId: string; command: JarvisPhoneCommand; workspaceId?: string | null }
): Promise<DispatchOutcome> {
  const { command } = input;
  // A dispatch that is genuinely still running must not be disturbed.
  if (isDispatchInFlight(command, DISPATCH_LEASE_MS)) throw new CommandNotRetryableError("in_flight");
  // ...but one whose lease has expired is exactly what retry exists for. Without
  // this, the stale-lease takeover in `claimDispatchAttempt` was unreachable:
  // every entry point pre-gated on a state a `dispatching` row is not in, so a
  // command whose process died mid-dispatch stayed wedged forever — the precise
  // failure the lease was added to prevent.
  const staleLease = command.dispatchState === "dispatching";
  if (!staleLease && command.dispatchState !== "failed") throw new CommandNotRetryableError("not_failed");
  // A stalled row is moved out of `dispatching` BEFORE any refusal below, so
  // every exit from here leaves it in a terminal state. Previously the
  // `projectId` and attempt-cap refusals came first and threw without writing,
  // which meant the most likely kill window of all — a process dying after the
  // project row exists but before the agents are launched — left the command
  // wedged in `dispatching` forever with no path out: retry threw, approve and
  // decline require `awaiting_approval`, and the call-side handlers only look
  // for `awaiting_confirmation`.
  // The reap bumps the revision, so the retry below must proceed from the row
  // it produced — running the claim against the pre-reap revision would lose
  // its own guard and report "already dispatched".
  const current = (staleLease ? await reapStalledDispatch(db, { organizationId: input.organizationId, command, actorUserId: input.actorUserId }) : null) ?? command;
  // A failed dispatch that already produced a project is NOT retryable: the
  // project exists, its tasks exist, and its agents may already be running.
  // Re-running would create a second copy of live work, which is worse than
  // the incomplete handoff the founder is looking at.
  if (current.projectId) throw new CommandNotRetryableError("partially_created");
  if (current.dispatchAttempts >= MAX_DISPATCH_ATTEMPTS) {
    // The cap is also enforced atomically inside the dispatch claim; this is
    // the early, friendly refusal so the caller gets a real 409 instead of a
    // confusing "already dispatched".
    throw new CommandNotRetryableError("attempts_exhausted");
  }

  return runDirectiveDispatch(db, {
    organizationId: input.organizationId,
    // The person who pressed retry is the actor, so every downstream
    // authorization check resolves against a real, current session.
    founderUserId: input.actorUserId,
    command: current,
    workspaceId: input.workspaceId ?? null,
  });
}

/**
 * Moves a command whose dispatch lease has expired out of `dispatching` and
 * into an honest terminal state.
 *
 * `dispatching` means "a process is working on this right now". A serverless
 * process that is killed mid-handoff throws nothing and writes nothing, so
 * without a reaper the row keeps that meaning forever: the screen reads
 * "Jarvis started opening this and then stopped without finishing", no button
 * is offered, and no entry point can move it — retry refused before writing,
 * approve and decline require `awaiting_approval`, and the call-side handlers
 * only look for `awaiting_confirmation`.
 *
 * Idempotent, revision-guarded, and safe to call from a read path: it only
 * ever fires on a row whose lease has already expired, and losing the guard
 * to a concurrent writer simply means someone else got there first.
 *
 * Returns the updated row, or null when there was nothing to do or the guard
 * was lost.
 */
export async function reapStalledDispatch(
  db: Db,
  input: { organizationId: string; command: JarvisPhoneCommand; actorUserId: string; nowMs?: number }
): Promise<JarvisPhoneCommand | null> {
  const { command } = input;
  if (command.dispatchState !== "dispatching") return null;
  if (isDispatchInFlight(command, DISPATCH_LEASE_MS, input.nowMs)) return null;

  // `projectId` is written the instant the project row exists, so a set value
  // means real work was created and a null value means the handoff stopped
  // before it was recorded. The message says exactly that much and no more —
  // claiming "nothing was started" would be a guess.
  const partial = Boolean(command.projectId);
  const failureCode = partial
    ? "partially_created"
    : command.dispatchAttempts >= MAX_DISPATCH_ATTEMPTS
      ? "attempts_exhausted"
      : "stalled";

  let reaped: JarvisPhoneCommand | null = null;
  try {
    reaped = await transitionCommand(db, {
      organizationId: input.organizationId,
      commandId: command.id,
      expectedRevision: command.revision,
      dispatchState: "failed",
      failureCode,
      failureMessage: partial
        ? "The handoff stopped part-way. The project was created; the rest of the setup may not have finished."
        : "The handoff stopped part-way. No project was recorded before it stopped.",
    });
  } catch {
    return null;
  }
  if (!reaped) return null;

  // A durable state change never happens unrecorded, even one nobody asked
  // for. Best-effort: the reaper runs on a read path, and a failed audit write
  // must not turn viewing the screen into an error.
  await recordAuditEvent(db, {
    eventType: "jarvis_phone_command_dispatch_failed",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    targetType: "jarvis_phone_command",
    targetId: command.id,
    metadata: { failureCode, attempts: reaped.dispatchAttempts, partiallyCreated: partial, reapedStaleLease: true },
  }).catch(() => {
    console.error("[jarvis-phone]", JSON.stringify(redactLogFields({ event: "reap-audit-failed", commandId: command.id })));
  });

  return reaped;
}

/**
 * Creates the directive for a command that is cleared to run — either
 * low-risk and confirmed on the call, gated and since approved by a human, or
 * a human-initiated retry of a dispatch that failed.
 * Shared so every path produces byte-identical Office records.
 */
export async function runDirectiveDispatch(
  db: Db,
  input: {
    organizationId: string;
    founderUserId: string;
    command: JarvisPhoneCommand;
    workspaceId: string | null;
    confirmationStatus?: JarvisPhoneCommand["confirmationStatus"];
    approvalDecidedByUserId?: string | null;
    approvalDecisionNote?: string | null;
  }
): Promise<DispatchOutcome> {
  // Claim the right to dispatch BEFORE creating anything. Two concurrent
  // callers — two confirmations, two admins, one double-click — would
  // otherwise both pass their checks and both create a real project with real
  // running agents. Exactly one can win this claim; the loser must not
  // dispatch, and reports the existing state instead.
  const command = await claimDispatchAttempt(db, {
    organizationId: input.organizationId,
    commandId: input.command.id,
    expectedRevision: input.command.revision,
    maxAttempts: MAX_DISPATCH_ATTEMPTS,
    // A dispatch may only begin from a state that has not begun one: confirmed
    // low-risk work, or a gated command a human just approved, or a previous
    // attempt that genuinely failed.
    // `dispatching` is deliberately absent: a LIVE lease is never claimable.
    // A stale one still is, through the timestamp branch inside the claim.
    fromStates: ["awaiting_confirmation", "awaiting_approval", "failed"],
    staleAfterMs: DISPATCH_LEASE_MS,
  });
  if (!command) {
    // Report what the row says NOW, not the caller's stale read — otherwise a
    // caller that lost the race to a dispatch already in flight is told
    // "nothing has started" while agents are being launched.
    const current = await resolveCommandById(db, { organizationId: input.organizationId, commandId: input.command.id }).catch(() => input.command);
    return { status: "already_dispatched", command: current, spoken: describeExistingState(current) };
  }

  // `toDirectiveInstruction` reads only the founder-authored fields; the risk
  // decision has already been made and is not re-derived here.
  const instruction = toDirectiveInstruction({
    requestedOutcome: command.requestedOutcome,
    target: command.targetName,
    constraints: command.constraints,
    proposedSteps: command.proposedSteps,
    missingInformation: command.missingInformation,
  });

  try {
    const result = await createDirectiveProject(db, {
      organizationId: input.organizationId,
      instruction,
      workspaceId: input.workspaceId,
      actorUserId: input.founderUserId,
      source: "founder_phone_call",
      // Written immediately, so that a process killed later in the handoff
      // leaves behind a command that KNOWS a project exists. Without this a
      // timeout mid-dispatch is indistinguishable from "nothing happened",
      // and the stale-lease retry would build a second copy of live work.
      onProjectCreated: async (project) => {
        await recordDispatchProject(db, { organizationId: input.organizationId, commandId: command.id, projectId: project.id });
      },
    });

    const dispatched = await transitionCommand(db, {
      organizationId: input.organizationId,
      commandId: command.id,
      expectedRevision: command.revision,
      ...(input.confirmationStatus ? { confirmationStatus: input.confirmationStatus } : {}),
      dispatchState: "directive_created",
      projectId: result.project.id,
      failureCode: null,
      failureMessage: null,
      ...(input.approvalDecidedByUserId !== undefined ? { approvalDecidedByUserId: input.approvalDecidedByUserId } : {}),
      ...(input.approvalDecisionNote !== undefined ? { approvalDecisionNote: input.approvalDecisionNote } : {}),
    });

    if (!dispatched) {
      // The project genuinely exists but the command row moved on underneath
      // us — a stale-lease takeover bumped the revision while this dispatch
      // was still running. Say so plainly rather than reporting a clean
      // success or a failure; both would be untrue.
      console.warn(
        "[jarvis-phone]",
        JSON.stringify(redactLogFields({ event: "dispatch-transition-lost", commandId: command.id, projectId: result.project.id }))
      );
      // Re-read for the same reason the lost-claim branch above does: the
      // caller's row is stale by definition here.
      const current = await resolveCommandById(db, { organizationId: input.organizationId, commandId: command.id }).catch(() => command);
      return { status: "already_dispatched", command: current, spoken: describeExistingState(current) };
    }

    // Deliberately best-effort and AFTER the row is authoritative: an audit
    // write that throws here would otherwise fall into the catch below, fail
    // its own guarded transition, and report a real, completed dispatch to the
    // founder as a failure.
    await recordAuditEvent(db, {
      eventType: "jarvis_phone_command_dispatched",
      organizationId: input.organizationId,
      actorUserId: input.founderUserId,
      targetType: "jarvis_phone_command",
      targetId: dispatched.id,
      metadata: { projectId: result.project.id, assignments: result.assignments.length, riskLevel: dispatched.riskLevel },
    }).catch((error) => {
      console.error("[jarvis-phone]", JSON.stringify(redactLogFields({ event: "dispatch-audit-failed", commandId: dispatched.id })));
      void error;
    });

    return {
      status: "directive_created",
      command: dispatched,
      projectId: result.project.id,
      projectName: result.project.name,
      assistantReply: result.assistantReply,
      launchedCount: result.launchedCount,
      spoken: `Done. I've opened the project ${result.project.name} and briefed the team. You can watch it on the Jarvis screen.`,
    };
  } catch (error) {
    const failureCode = classifyDispatchFailure(error);
    const message = error instanceof Error ? error.message : "unknown error";
    // A partial creation means a real project — possibly with agents already
    // running — exists despite the failure. Recording its id is what stops a
    // later retry from creating a second copy of live work.
    const partial = error instanceof DirectivePartiallyCreatedError ? error : null;
    console.error(
      "[jarvis-phone]",
      JSON.stringify(redactLogFields({ event: "dispatch-failed", commandId: command.id, failureCode, partiallyCreated: Boolean(partial) }))
    );

    const failed = await transitionCommand(db, {
      organizationId: input.organizationId,
      commandId: command.id,
      expectedRevision: command.revision,
      ...(input.confirmationStatus ? { confirmationStatus: input.confirmationStatus } : {}),
      dispatchState: "failed",
      failureCode,
      failureMessage: message.slice(0, 500),
      ...(partial ? { projectId: partial.projectId } : {}),
      // The approver's identity must survive a failed dispatch. Without this,
      // an approved-then-failed critical command would show on screen with no
      // record of who approved it, next to a live retry button.
      ...(input.approvalDecidedByUserId !== undefined ? { approvalDecidedByUserId: input.approvalDecidedByUserId } : {}),
      ...(input.approvalDecisionNote !== undefined ? { approvalDecisionNote: input.approvalDecisionNote } : {}),
    });

    // Best-effort, for the same reason the success path is — and doubly so
    // here. A dispatch failure is very often CAUSED by database or provider
    // trouble, which is exactly the condition under which the audit insert
    // also fails. Unguarded, that turned an honestly-recorded failure into a
    // thrown error: on the call path the founder heard nothing at all instead
    // of "I couldn't open the project just now", and on the decision route it
    // became a 500 rather than the real reason.
    await recordAuditEvent(db, {
      eventType: "jarvis_phone_command_dispatch_failed",
      organizationId: input.organizationId,
      actorUserId: input.founderUserId,
      targetType: "jarvis_phone_command",
      targetId: command.id,
      metadata: { failureCode, attempts: failed?.dispatchAttempts ?? command.dispatchAttempts, partiallyCreated: Boolean(partial) },
    }).catch(() => {
      console.error("[jarvis-phone]", JSON.stringify(redactLogFields({ event: "dispatch-failure-audit-failed", commandId: command.id })));
    });

    return {
      status: "failed",
      command: failed ?? command,
      failureCode,
      spoken: partial
        ? `I started opening the project but couldn't finish the handoff, and I'm not going to pretend otherwise. Some of it may already be running — it's on the Jarvis screen under ${partial.projectName}.`
        : "I couldn't open the project just now, and I'm not going to pretend otherwise. I've saved exactly what you asked for on the Jarvis screen with the reason it failed, so you can retry it there.",
    };
  }
}

/**
 * A bounded, machine-readable failure vocabulary. `unknown_error` is a real
 * value, not a fallback that hides a class of failure — it means "we did not
 * recognize this", and the message is stored alongside it.
 */
function classifyDispatchFailure(rawError: unknown): string {
  // A partial creation wraps the real error, so classify what actually went
  // wrong rather than the wrapper — otherwise `authorization_failed` and
  // `resource_not_found` become unreachable past the first write.
  const error = rawError instanceof DirectivePartiallyCreatedError ? rawError.reason : rawError;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (error instanceof Error && error.name) {
    if (/authz|role|membership|tenant/i.test(error.name)) return "authorization_failed";
    // Deliberately after the authorization test, and currently unreachable.
    // The one not-found error this path can raise is
    // `TenantResourceNotFoundError`, which is an AUTHORIZATION outcome wearing
    // a 404 — the codebase returns it so a cross-tenant read cannot confirm a
    // row exists — so "Jarvis was not allowed to open it" is the honest label
    // for it and the order must stay this way. This branch is the fallback for
    // a future not-found error that is genuinely about a missing resource; a
    // review flagged its unreachability, and the answer is a comment rather
    // than a reorder that would mislabel a permissions failure.
    if (/notfound/i.test(error.name)) return "resource_not_found";
  }
  if (/rate limit|429|quota|too many requests/.test(message)) return "model_rate_limited";
  if (/timeout|timed out|abort/.test(message)) return "timed_out";
  if (/no eligible agents/.test(message)) return "no_agents_available";
  if (/fetch failed|econnreset|network/.test(message)) return "provider_unreachable";
  return "unknown_error";
}

/** Never claims more than the row actually says. Used whenever a retry finds the work already done. */
function describeExistingState(command: JarvisPhoneCommand): string {
  switch (command.dispatchState) {
    case "directive_created":
      return "I already opened that project — it's on the Jarvis screen.";
    case "awaiting_approval":
      return "That one is already waiting for your approval in LYNQ Office. Nothing has started.";
    case "declined":
      return "That one was declined in the Office, so nothing was started.";
    case "cancelled":
      return "You cancelled that one, so I didn't start anything.";
    case "failed":
      return "That one failed to open earlier. The reason is saved on the Jarvis screen.";
    case "dispatching":
      return "I'm opening that one right now — give it a moment and it'll show up on the Jarvis screen.";
    default:
      return "I already have that one recorded.";
  }
}
