import "server-only";

import { after } from "next/server";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { handleRouteError, jsonSuccess } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { requireOrganizationAdminOverride } from "@/lib/authz/helpers";
import { CommandAlreadyDecidedError, CommandNotAwaitingApprovalError } from "@/lib/voice/errors";
import { recordAuditEvent } from "@/lib/audit";
import { pollAndProcess } from "@/lib/runtime/worker";
import { claimApprovalDecision, resolveCommandById } from "@/lib/voice/call-store";
import { MAX_DISPATCH_ATTEMPTS, retryFailedDispatch, runDirectiveDispatch } from "@/lib/voice/command-dispatch";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z
  .object({
    // `retry` is not a decision about whether work may happen — that was
    // already settled. It re-attempts a dispatch that genuinely failed.
    decision: z.enum(["approve", "decline", "retry"]),
    decisionNote: z.string().trim().max(1000).optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; commandId: string }> };

/**
 * Says what actually happened. "Nothing was started" is only true when no
 * project exists — a partially created directive has a live project and
 * possibly running agents, and telling the founder otherwise (while the screen
 * 40 lines away says the opposite) is the failure this lane keeps having to
 * fix.
 */
function describeDispatchFailure(failureCode: string, projectId: string | null, remainingAttempts: number): string {
  const reason = failureCode.replace(/_/g, " ");
  if (projectId) {
    return `The project was created but Jarvis could not finish briefing the team (${reason}). Some of the work may already be running — open the project rather than trying again.`;
  }
  const remaining = Math.max(0, remainingAttempts);
  return `It failed (${reason}). Nothing was started.${remaining > 0 ? ` You can try ${remaining} more time${remaining === 1 ? "" : "s"}.` : " This one has been tried as many times as it can be."}`;
}

/**
 * The human decision on a gated phone command — the one place a spoken
 * instruction for outreach, payment, a third-party call, a production change,
 * a deletion, a contract, or credential access can ever become real work.
 *
 * Everything about this route is the safety property the phone lane depends
 * on:
 *
 * - It requires a validated database session and organization owner/admin
 *   (`requireOrganizationAdminOverride`) — the same authority floor
 *   `requireApproverAuthority` enforces for an Agent Runtime approval. Nothing
 *   said on a phone call can reach it.
 * - It decides ONCE: the transition is guarded by the revision the command was
 *   read at, so a double-submit cannot approve twice or create two projects.
 * - Approving runs the SAME `runDirectiveDispatch` a low-risk command runs, so
 *   an approved gated command produces an identical Office record — one
 *   orchestration system, not two.
 *
 * It also handles `retry`, which is not an approval: a command can only reach
 * `failed` from a dispatch that was already cleared to run, so retrying one
 * can never manufacture consent that was not already given.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, commandId: rawCommandId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const commandId = parseUuidParam(rawCommandId);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    await requireOrganizationAdminOverride(db, organizationId, user.userId);
    const body = await parseJsonBody(request, bodySchema);

    // Scoped by id AND organization — never fetched globally and authorized after.
    const command = await resolveCommandById(db, { organizationId, commandId });

    if (body.decision === "retry") {
      const outcome = await retryFailedDispatch(db, { organizationId, actorUserId: user.userId, command, workspaceId: null });

      await recordAuditEvent(db, {
        eventType: "jarvis_phone_command_retried",
        organizationId,
        actorUserId: user.userId,
        targetType: "jarvis_phone_command",
        targetId: commandId,
        metadata: { outcome: outcome.status, attempt: command.dispatchAttempts + 1, riskLevel: command.riskLevel },
      });

      if (outcome.status === "directive_created") {
        const rawSql = neon(env.DATABASE_URL);
        after(async () => {
          await pollAndProcess(db, rawSql, {
            leaseOwner: `jarvis-phone-command:${outcome.command.id}`,
            jobTypes: ["execution_run"],
            maxJobs: outcome.launchedCount,
          });
        });

        return jsonSuccess({
          decision: "retry",
          command: { id: outcome.command.id, dispatchState: outcome.command.dispatchState, projectId: outcome.projectId },
          message: `It worked this time. ${outcome.assistantReply}`,
        });
      }

      if (outcome.status === "failed") {
        const remaining = Math.max(0, MAX_DISPATCH_ATTEMPTS - outcome.command.dispatchAttempts);
        return jsonSuccess({
          decision: "retry",
          command: { id: outcome.command.id, dispatchState: outcome.command.dispatchState, projectId: outcome.command.projectId },
          message: describeDispatchFailure(outcome.failureCode, outcome.command.projectId, remaining),
        });
      }

      return jsonSuccess({
        decision: "retry",
        command: { id: outcome.command.id, dispatchState: outcome.command.dispatchState, projectId: outcome.command.projectId },
        message: outcome.spoken,
      });
    }

    if (command.dispatchState !== "awaiting_approval") {
      throw new CommandNotAwaitingApprovalError(command.dispatchState);
    }

    if (body.decision === "decline") {
      // The SAME fact-based guard the approve path uses, not a revision guard.
      // Approval does not change `dispatchState` — the dispatch claim does —
      // so between one admin's approval and their dispatch claim the row is
      // still `awaiting_approval` at a new revision, and a revision-guarded
      // decline landing in that window succeeded: it overwrote the recorded
      // approver and marked as declined a command that had just been approved.
      const declined = await claimApprovalDecision(db, {
        organizationId,
        commandId,
        approverUserId: user.userId,
        decisionNote: body.decisionNote ?? null,
        dispatchState: "declined",
      });
      if (!declined) throw new CommandAlreadyDecidedError();

      await recordAuditEvent(db, {
        eventType: "jarvis_phone_command_decided",
        organizationId,
        actorUserId: user.userId,
        targetType: "jarvis_phone_command",
        targetId: commandId,
        metadata: { decision: "declined", riskLevel: declined.riskLevel },
      });

      return jsonSuccess({
        decision: "declined",
        command: { id: declined.id, dispatchState: declined.dispatchState, projectId: null },
        message: "Declined. Nothing was started.",
      });
    }

    // The approval is recorded on the row BEFORE any work is created, and this
    // write is what decides once: the revision guard means a double-submit or
    // a second admin gets `null` here and is refused, so the dispatch claim
    // below is a second line of defence rather than the only one.
    //
    // Ordering matters for more than concurrency. The identity of the approver
    // used to be written only by the transition at the END of a dispatch, and
    // the audit event only after it returned — so a process killed mid-handoff
    // (a serverless timeout, a deploy) left a command that had been approved by
    // a human, with work possibly already running, and no record anywhere of
    // who approved it. `dispatchConfirmedCommand` already records the
    // confirmation before acting for exactly this reason.
    const approved = await claimApprovalDecision(db, {
      organizationId,
      commandId,
      approverUserId: user.userId,
      decisionNote: body.decisionNote ?? null,
    });
    if (!approved) throw new CommandAlreadyDecidedError();

    await recordAuditEvent(db, {
      eventType: "jarvis_phone_command_decided",
      organizationId,
      actorUserId: user.userId,
      targetType: "jarvis_phone_command",
      targetId: commandId,
      metadata: { decision: "approved", riskLevel: approved.riskLevel },
    });

    // What the dispatch then did is audited by the dispatcher itself, as
    // `jarvis_phone_command_dispatched` or `..._dispatch_failed`, so the
    // decision and its outcome are two honest records rather than one that
    // can only be written if both succeed.
    const outcome = await runDirectiveDispatch(db, {
      organizationId,
      // The approver becomes the project's actor: they are the human who
      // authorized this work, and every downstream authorization check should
      // resolve against them rather than against a call that has since ended.
      founderUserId: user.userId,
      command: approved,
      workspaceId: null,
      approvalDecidedByUserId: user.userId,
      approvalDecisionNote: body.decisionNote ?? null,
    });

    if (outcome.status === "directive_created") {
      const rawSql = neon(env.DATABASE_URL);
      after(async () => {
        await pollAndProcess(db, rawSql, {
          leaseOwner: `jarvis-phone-command:${outcome.command.id}`,
          jobTypes: ["execution_run"],
          maxJobs: outcome.launchedCount,
        });
      });

      return jsonSuccess({
        decision: "approved",
        command: { id: outcome.command.id, dispatchState: outcome.command.dispatchState, projectId: outcome.projectId },
        message: `Approved. ${outcome.assistantReply}`,
      });
    }

    if (outcome.status === "failed") {
      // A real failure is reported as one — but "nothing was started" is only
      // true when no project exists. A partial creation has live records.
      return jsonSuccess({
        decision: "approved",
        command: { id: outcome.command.id, dispatchState: outcome.command.dispatchState, projectId: outcome.command.projectId },
        message: `Approved. ${describeDispatchFailure(outcome.failureCode, outcome.command.projectId, MAX_DISPATCH_ATTEMPTS - outcome.command.dispatchAttempts)}`,
      });
    }

    // `outcome.command` is re-read by the dispatcher for this branch, so the
    // reported state is the row's real one rather than the caller's stale read.
    return jsonSuccess({
      decision: outcome.status === "already_dispatched" ? "no_op" : "approved",
      command: { id: outcome.command.id, dispatchState: outcome.command.dispatchState, projectId: outcome.command.projectId },
      message: outcome.spoken,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
