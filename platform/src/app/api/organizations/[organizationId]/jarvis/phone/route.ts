import "server-only";

import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { handleRouteError, jsonSuccess } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { listPhoneCallsForUser } from "@/lib/voice/call-store";
import { requireOrganizationMembership } from "@/lib/authz/helpers";
import { getJarvisPhoneCommandReadiness, resolveJarvisPhoneCommandConfig } from "@/lib/voice/phone-config";
import { GATED_CATEGORY_LABELS, type GatedCategory } from "@/lib/voice/command-risk";
import { DISPATCH_LEASE_MS, MAX_DISPATCH_ATTEMPTS, reapStalledDispatch } from "@/lib/voice/command-dispatch";
import { isDispatchInFlight } from "@/lib/voice/call-store";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/**
 * Live phone-control state for the Jarvis Command Center: what Mustafa said,
 * what Jarvis understood, what Jarvis proposes, what requires approval, and
 * whether work started.
 *
 * Tenant-scoped through `listPhoneCallsForUser`, which requires a real
 * organization membership — a member of another organization gets the same
 * 404 every other cross-tenant read in this codebase returns.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const loaded = await listPhoneCallsForUser(db, { organizationId, actorUserId: user.userId, limit: 10 });
    // Readiness is scoped to THIS organization, not to the deployment: phone
    // control is configured for exactly one organization, and every other
    // tenant used to be shown the whole surface for a capability it does not
    // have.
    const readiness = getJarvisPhoneCommandReadiness(organizationId);

    // Any member may READ this screen, but only an owner/admin may approve,
    // decline, or retry — the same floor the decision route enforces. The UI
    // needs to know, or it renders buttons that are refused on click.
    const membership = await requireOrganizationMembership(db, organizationId, user.userId);
    const canDecide = membership.role === "owner" || membership.role === "admin";

    // Reap any dispatch whose lease has expired before rendering. `dispatching`
    // means "a process is working on this right now", and a serverless process
    // killed mid-handoff throws nothing and writes nothing — so without this
    // the row keeps that meaning forever and no entry point can move it. The
    // write is idempotent, revision-guarded, and only ever fires on a row whose
    // lease has already expired; losing the guard to a concurrent writer just
    // means someone else got there first.
    const calls = await Promise.all(
      loaded.map(async (call) => ({
        ...call,
        commands: await Promise.all(
          call.commands.map(async (command) => {
            if (command.dispatchState !== "dispatching" || isDispatchInFlight(command, DISPATCH_LEASE_MS)) return command;
            const reaped = await reapStalledDispatch(db, { organizationId, command, actorUserId: user.userId });
            return reaped ? { ...command, ...reaped } : command;
          })
        ),
      }))
    );

    // The passcode is the FOUNDER's second factor and is scoped by time, not by
    // user, so only the configured founder account may see it. The screen needs
    // to know: a panel offering "Show my code" to someone who will be refused is
    // the same defect as a button that is refused on click.
    const phoneConfig = resolveJarvisPhoneCommandConfig();
    const canSeePasscode =
      phoneConfig.ok && phoneConfig.config.organizationId === organizationId && phoneConfig.config.founderUserId === user.userId;

    return jsonSuccess({
      readiness,
      canDecide,
      canSeePasscode,
      calls: calls.map((call) => ({
        session: {
          id: call.session.id,
          status: call.session.status,
          verificationState: call.session.verificationState,
          verificationAttempts: call.session.verificationAttempts,
          callerNumberLastFour: call.session.callerNumberLastFour,
          callerNumberMatched: call.session.callerNumberMatched,
          deliveryStatus: call.session.deliveryStatus,
          endedReason: call.session.endedReason,
          failureCode: call.session.failureCode,
          startedAt: call.session.startedAt.toISOString(),
          endedAt: call.session.endedAt?.toISOString() ?? null,
        },
        // Already redacted at write time; nothing here needs further filtering.
        turns: call.turns
          .filter((turn) => turn.isFinal)
          .map((turn) => ({ id: turn.id, role: turn.role, text: turn.redactedText, redactedKinds: turn.redactedKinds })),
        commands: call.commands.map((command) => ({
          id: command.id,
          requestedOutcome: command.requestedOutcome,
          target: command.targetName,
          constraints: command.constraints,
          requiredIntegrations: command.requiredIntegrations,
          proposedSteps: command.proposedSteps,
          missingInformation: command.missingInformation,
          riskLevel: command.riskLevel,
          requiresApproval: command.requiresApproval,
          gatedReasons: (command.gatedCategories as GatedCategory[])
            .map((category) => GATED_CATEGORY_LABELS[category])
            .filter(Boolean),
          riskReasons: command.riskReasons,
          overrideAttempted: command.overrideAttempted,
          readback: command.readbackText,
          confirmationStatus: command.confirmationStatus,
          dispatchState: command.dispatchState,
          projectId: command.projectId,
          projectName: command.projectName,
          projectKey: command.projectKey,
          failureCode: command.failureCode,
          failureMessage: command.failureMessage,
          dispatchAttempts: command.dispatchAttempts,
          // Whether the UI may offer a retry at all — computed here so the
          // button can never appear for something that would be refused.
          // Mirrors every condition the decision route enforces, including the
          // viewer's authority — a button must never appear for something that
          // would be refused. A partially-created project is deliberately NOT
          // retryable: the work already exists.
          retryable:
            canDecide &&
            (command.dispatchState === "failed" || command.dispatchState === "dispatching") &&
            command.projectId === null &&
            command.dispatchAttempts < MAX_DISPATCH_ATTEMPTS &&
            !isDispatchInFlight(command, DISPATCH_LEASE_MS),
          // True only while a dispatch is genuinely running. A `dispatching`
          // row past its lease is NOT in flight — it is stuck, and the screen
          // must say so rather than promising it is still working.
          inFlight: isDispatchInFlight(command, DISPATCH_LEASE_MS),
          decidedAt: command.approvalDecidedAt?.toISOString() ?? null,
          decisionNote: command.approvalDecisionNote,
          createdAt: command.createdAt.toISOString(),
        })),
      })),
      // A live call or an in-flight dispatch is worth re-reading; a settled
      // list is not.
      refreshAfterMs:
        calls.some((call) => call.session.status === "active") ||
        calls.some((call) => call.commands.some((command) => isDispatchInFlight(command, DISPATCH_LEASE_MS)))
          ? 5000
          : null,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
