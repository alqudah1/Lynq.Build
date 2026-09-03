import "server-only";

import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { handleRouteError, jsonSuccess } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { listPhoneCallsForUser } from "@/lib/voice/call-store";
import { requireOrganizationMembership } from "@/lib/authz/helpers";
import { getJarvisPhoneCommandReadiness } from "@/lib/voice/phone-config";
import { GATED_CATEGORY_LABELS, type GatedCategory } from "@/lib/voice/command-risk";
import { MAX_DISPATCH_ATTEMPTS } from "@/lib/voice/command-dispatch";

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

    const calls = await listPhoneCallsForUser(db, { organizationId, actorUserId: user.userId, limit: 10 });
    const readiness = getJarvisPhoneCommandReadiness();

    // Any member may READ this screen, but only an owner/admin may approve,
    // decline, or retry — the same floor the decision route enforces. The UI
    // needs to know, or it renders buttons that are refused on click.
    const membership = await requireOrganizationMembership(db, organizationId, user.userId);
    const canDecide = membership.role === "owner" || membership.role === "admin";

    return jsonSuccess({
      readiness,
      canDecide,
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
            command.dispatchState === "failed" &&
            command.projectId === null &&
            command.dispatchAttempts < MAX_DISPATCH_ATTEMPTS,
          decidedAt: command.approvalDecidedAt?.toISOString() ?? null,
          decisionNote: command.approvalDecisionNote,
          createdAt: command.createdAt.toISOString(),
        })),
      })),
      // A live call is worth re-reading; a settled list is not.
      refreshAfterMs: calls.some((call) => call.session.status === "active") ? 5000 : null,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
