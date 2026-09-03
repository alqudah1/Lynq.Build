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
import { resolveCommandById, transitionCommand } from "@/lib/voice/call-store";
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
          command: { id: outcome.command.id, dispatchState: outcome.command.dispatchState, projectId: null },
          message: `It failed again (${outcome.failureCode.replace(/_/g, " ")}). Nothing was started.${remaining > 0 ? ` You can try ${remaining} more time${remaining === 1 ? "" : "s"}.` : " This one has been retried as many times as it can be."}`,
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
      const declined = await transitionCommand(db, {
        organizationId,
        commandId,
        expectedRevision: command.revision,
        dispatchState: "declined",
        approvalDecidedByUserId: user.userId,
        approvalDecisionNote: body.decisionNote ?? null,
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

    const outcome = await runDirectiveDispatch(db, {
      organizationId,
      // The approver becomes the project's actor: they are the human who
      // authorized this work, and every downstream authorization check should
      // resolve against them rather than against a call that has since ended.
      founderUserId: user.userId,
      command,
      workspaceId: null,
      approvalDecidedByUserId: user.userId,
      approvalDecisionNote: body.decisionNote ?? null,
    });

    await recordAuditEvent(db, {
      eventType: "jarvis_phone_command_decided",
      organizationId,
      actorUserId: user.userId,
      targetType: "jarvis_phone_command",
      targetId: commandId,
      metadata: { decision: "approved", outcome: outcome.status, riskLevel: command.riskLevel },
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
      // A real failure is reported as one. The command stays visible with its
      // reason so the founder can retry rather than wonder.
      return jsonSuccess({
        decision: "approved",
        command: { id: outcome.command.id, dispatchState: outcome.command.dispatchState, projectId: null },
        message: `Approved, but the project could not be opened (${outcome.failureCode}). Nothing was started. You can try again from here.`,
      });
    }

    return jsonSuccess({
      decision: "approved",
      command: { id: outcome.command.id, dispatchState: outcome.command.dispatchState, projectId: outcome.command.projectId },
      message: outcome.spoken,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
