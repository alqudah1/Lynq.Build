import "server-only";

import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { handleRouteError, jsonSuccess } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { requireOrganizationAdminOverride } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import {
  deriveFounderPasscode,
  passcodeMillisecondsRemaining,
  FounderVerificationUnavailableError,
} from "@/lib/voice/founder-verification";
import { resolveJarvisPhoneCommandConfig } from "@/lib/voice/phone-config";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/**
 * The rotating six-digit code the founder reads to Jarvis on a call.
 *
 * This route IS the second authentication factor. Everything about it is
 * therefore deliberately strict:
 *
 * - It requires a validated database session (`getAuthenticatedUser`) — the
 *   code is never derivable from the phone side alone.
 * - It requires organization owner/admin, via the existing
 *   `requireOrganizationAdminOverride`, so a viewer or member of the same
 *   organization cannot mint a code that would let a caller act as the
 *   founder.
 * - It only ever returns a code for the organization phone control is
 *   actually configured for; asking any other organization returns 404, not
 *   a code that would silently never work.
 * - Every issuance is audited. The code itself is never audited or logged.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    await requireOrganizationAdminOverride(db, organizationId, user.userId);

    const resolution = resolveJarvisPhoneCommandConfig();
    if (!resolution.ok) {
      // Honest, non-leaking: says it is unavailable and why in category
      // terms, never which secret is missing or what its value looks like.
      return jsonSuccess({
        available: false,
        reason: resolution.reason,
        passcode: null,
        expiresInMs: null,
      });
    }
    if (resolution.config.organizationId !== organizationId) {
      return jsonSuccess({ available: false, reason: "not_configured_for_organization", passcode: null, expiresInMs: null });
    }

    const now = Date.now();
    const passcode = deriveFounderPasscode(resolution.config.verificationSecret, now);

    await recordAuditEvent(db, {
      // Deliberately its own event type, not `jarvis_phone_founder_verified`:
      // "a code was displayed in a browser" and "a caller authenticated on a
      // call" are different facts, and an auditor must be able to tell them
      // apart.
      eventType: "jarvis_phone_passcode_issued",
      organizationId,
      actorUserId: user.userId,
      targetType: "jarvis_phone_passcode",
      // No target id and no code — only the fact that one was issued.
      metadata: { issued: true, channel: "command_center" },
    });

    return jsonSuccess({
      available: true,
      passcode,
      expiresInMs: passcodeMillisecondsRemaining(now),
    });
  } catch (err) {
    if (err instanceof FounderVerificationUnavailableError) {
      return jsonSuccess({ available: false, reason: "incomplete_configuration", passcode: null, expiresInMs: null });
    }
    return handleRouteError(err);
  }
}
