import "server-only";

import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { recordAuditEvent } from "@/lib/audit";
import { createDirectiveProject } from "@/lib/office/directive-intake";
import { toDirectiveInstruction } from "./command-draft";
import { redactLogFields } from "./redaction";
import { transitionCommand, type JarvisPhoneCommand } from "./call-store";
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

  if (command.requiresApproval) {
    const gated = await transitionCommand(db, {
      organizationId: input.organizationId,
      commandId: command.id,
      expectedRevision: command.revision,
      confirmationStatus: "confirmed",
      dispatchState: "awaiting_approval",
    });
    if (!gated) return { status: "already_dispatched", command, spoken: describeExistingState(command) };

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
      spoken:
        "I've written that up and put it in LYNQ Office for your approval. Nothing has started, and nothing will until you approve it there. It's on the Jarvis screen now.",
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
  if (command.dispatchState !== "failed") throw new CommandNotRetryableError("not_failed");
  if (command.dispatchAttempts >= MAX_DISPATCH_ATTEMPTS) throw new CommandNotRetryableError("attempts_exhausted");

  return runDirectiveDispatch(db, {
    organizationId: input.organizationId,
    // The person who pressed retry is the actor, so every downstream
    // authorization check resolves against a real, current session.
    founderUserId: input.actorUserId,
    command,
    workspaceId: input.workspaceId ?? null,
  });
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
  const { command } = input;
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
      incrementDispatchAttempts: true,
      ...(input.approvalDecidedByUserId !== undefined ? { approvalDecidedByUserId: input.approvalDecidedByUserId } : {}),
      ...(input.approvalDecisionNote !== undefined ? { approvalDecisionNote: input.approvalDecisionNote } : {}),
    });

    if (!dispatched) {
      // The project genuinely exists but the command row moved on underneath
      // us. Say so plainly rather than reporting a clean success or a
      // failure — both would be untrue.
      console.warn(
        "[jarvis-phone]",
        JSON.stringify(redactLogFields({ event: "dispatch-transition-lost", commandId: command.id, projectId: result.project.id }))
      );
      return { status: "already_dispatched", command, spoken: describeExistingState(command) };
    }

    await recordAuditEvent(db, {
      eventType: "jarvis_phone_command_dispatched",
      organizationId: input.organizationId,
      actorUserId: input.founderUserId,
      targetType: "jarvis_phone_command",
      targetId: dispatched.id,
      metadata: { projectId: result.project.id, assignments: result.assignments.length, riskLevel: dispatched.riskLevel },
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
    console.error("[jarvis-phone]", JSON.stringify(redactLogFields({ event: "dispatch-failed", commandId: command.id, failureCode })));

    const failed = await transitionCommand(db, {
      organizationId: input.organizationId,
      commandId: command.id,
      expectedRevision: command.revision,
      ...(input.confirmationStatus ? { confirmationStatus: input.confirmationStatus } : {}),
      dispatchState: "failed",
      failureCode,
      failureMessage: message.slice(0, 500),
      incrementDispatchAttempts: true,
    });

    await recordAuditEvent(db, {
      eventType: "jarvis_phone_command_dispatch_failed",
      organizationId: input.organizationId,
      actorUserId: input.founderUserId,
      targetType: "jarvis_phone_command",
      targetId: command.id,
      metadata: { failureCode, attempts: (failed?.dispatchAttempts ?? command.dispatchAttempts) + 0 },
    });

    return {
      status: "failed",
      command: failed ?? command,
      failureCode,
      spoken:
        "I couldn't open the project just now, and I'm not going to pretend otherwise. I've saved exactly what you asked for on the Jarvis screen with the reason it failed, so you can retry it there.",
    };
  }
}

/**
 * A bounded, machine-readable failure vocabulary. `unknown_error` is a real
 * value, not a fallback that hides a class of failure — it means "we did not
 * recognize this", and the message is stored alongside it.
 */
function classifyDispatchFailure(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (error instanceof Error && error.name) {
    if (/authz|role|membership|tenant/i.test(error.name)) return "authorization_failed";
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
    default:
      return "I already have that one recorded.";
  }
}
