import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { resolveConnectionById, resolveActiveCredentialSecret } from "@/lib/communications-os/connections";
import { processInboundProviderEvent, type ProcessOutcome } from "@/lib/communications-os/webhooks";
import { verifyResendWebhookSignature } from "@/lib/communications-os/providers/resend";
import {
  parseWhatsAppCredential,
  resolveWebhookVerificationChallenge,
  splitWhatsAppWebhookPayload,
  verifyWhatsAppWebhookSignature,
} from "@/lib/communications-os/providers/whatsapp-cloud";
import { timingSafeEqualStrings } from "@/lib/communications-os/secrets";
import { INTEGRATION_PROVIDERS, type IntegrationProvider } from "@/lib/communications-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ provider: string; connectionId: string }> };

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message, requestId: crypto.randomUUID() } }, { status });
}

/**
 * ============================================================================
 * Provider webhook ingestion — Module 16, extended for the Cloud API
 * ============================================================================
 * Dedicated, unauthenticated-by-session route — a real provider cannot
 * carry a human session cookie. Authenticity comes from a provider-
 * specific signature check (Resend's Svix HMAC, Meta's
 * `X-Hub-Signature-256`) or, for the development providers, a shared
 * bearer secret — never from `getAuthenticatedUser`.
 *
 * One deliberate refinement beyond the spec's own literal
 * `/api/integrations/:provider/webhook` suggestion: this path also
 * carries `connectionId`. A provider-only path cannot resolve which of
 * potentially many organizations' connections a given webhook belongs to
 * — each connection has its own unique webhook URL (shown on its detail
 * page), the realistic multi-tenant shape any real provider integration
 * needs. For WhatsApp this is not merely convenient: Meta's app secret
 * and verify token are stored inside the CONNECTION's own encrypted
 * credential, so the connection must be known before the signature can
 * be checked at all.
 */

/**
 * Meta's subscription handshake. Called once, by hand, when Mustafa
 * points the WhatsApp app's webhook at this URL — Meta issues
 * `GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…` and
 * expects the raw challenge echoed back as `text/plain`. The verify
 * token is compared in constant time against the one stored in the
 * connection's encrypted credential; no other provider implements GET.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { provider: rawProvider, connectionId: rawConnectionId } = await params;
    if (rawProvider !== "whatsapp_cloud_api") {
      return errorResponse("method_not_supported", "This provider has no webhook verification handshake", 405);
    }
    const connectionId = parseUuidParam(rawConnectionId);

    const env = loadEnv();
    const db = createDbClient(env);

    const { integrationConnections } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const [connectionRow] = await db.select().from(integrationConnections).where(eq(integrationConnections.id, connectionId));
    if (!connectionRow || connectionRow.provider !== "whatsapp_cloud_api") {
      return errorResponse("not_found", "Unknown connection", 404);
    }

    const secret = await resolveActiveCredentialSecret(db, { organizationId: connectionRow.organizationId, connectionId });
    if (!secret) return errorResponse("connection_not_configured", "Connection has no active credential", 409);

    const credential = parseWhatsAppCredential(secret);
    if (!credential.webhookVerifyToken) {
      return errorResponse("connection_not_configured", "Connection credential has no webhookVerifyToken", 409);
    }

    const url = new URL(request.url);
    const challenge = resolveWebhookVerificationChallenge({
      mode: url.searchParams.get("hub.mode"),
      verifyToken: url.searchParams.get("hub.verify_token"),
      challenge: url.searchParams.get("hub.challenge"),
      expectedVerifyToken: credential.webhookVerifyToken,
    });
    if (challenge === null) return errorResponse("verification_failed", "hub.verify_token did not match", 403);

    return new Response(challenge, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { provider: rawProvider, connectionId: rawConnectionId } = await params;
    if (!(INTEGRATION_PROVIDERS as readonly string[]).includes(rawProvider)) {
      return errorResponse("unknown_provider", "Unknown provider", 404);
    }
    const provider = rawProvider as IntegrationProvider;
    const connectionId = parseUuidParam(rawConnectionId);

    const env = loadEnv();
    const db = createDbClient(env);

    // Resolve the connection WITHOUT any human actor — this is a
    // machine-to-machine callback. `resolveConnectionById` takes a bare
    // organizationId, which we don't have yet, so we look the connection
    // up directly, tenant-implicit-by-id, then verify the signature
    // before trusting anything about it further.
    const { integrationConnections } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const [connectionRow] = await db.select().from(integrationConnections).where(eq(integrationConnections.id, connectionId));
    if (!connectionRow || connectionRow.provider !== provider) {
      return errorResponse("not_found", "Unknown connection", 404);
    }

    const rawBody = await request.text();

    if (provider === "resend") {
      const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
      const svixId = request.headers.get("svix-id");
      const svixTimestamp = request.headers.get("svix-timestamp");
      const svixSignature = request.headers.get("svix-signature");
      if (!webhookSecret || !svixId || !svixTimestamp || !svixSignature) {
        return errorResponse("unauthenticated_webhook", "Missing signature", 401);
      }
      if (!verifyResendWebhookSignature({ webhookSecret, svixId, svixTimestamp, rawBody, svixSignatureHeader: svixSignature })) {
        return errorResponse("invalid_webhook_signature", "Signature verification failed", 401);
      }
    } else if (provider === "whatsapp_cloud_api") {
      const secret = await resolveActiveCredentialSecret(db, { organizationId: connectionRow.organizationId, connectionId });
      if (!secret) return errorResponse("connection_not_configured", "Connection has no active credential", 409);
      const credential = parseWhatsAppCredential(secret);
      if (!credential.appSecret) {
        // Fail closed. An unsigned Meta webhook is an open door for
        // anyone who learns the URL, and this URL appears in Meta's own
        // app dashboard.
        return errorResponse("connection_not_configured", "Connection credential has no appSecret; webhook cannot be authenticated", 409);
      }
      if (!verifyWhatsAppWebhookSignature({ appSecret: credential.appSecret, rawBody, signatureHeader: request.headers.get("x-hub-signature-256") })) {
        return errorResponse("invalid_webhook_signature", "X-Hub-Signature-256 verification failed", 401);
      }
    } else if (provider === "dev_email" || provider === "dev_sms" || provider === "dev_whatsapp") {
      const devSecret = process.env.COMMUNICATIONS_DEV_WEBHOOK_SECRET;
      const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (!devSecret || !provided || !timingSafeEqualStrings(provided, devSecret)) {
        return errorResponse("unauthenticated_webhook", "Missing or invalid dev webhook secret", 401);
      }
    } else {
      return errorResponse("provider_not_implemented", `No webhook handler for provider "${provider}"`, 501);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return errorResponse("invalid_payload", "Body is not valid JSON", 400);
    }

    const connection = await resolveConnectionById(db, connectionRow.organizationId, connectionId);

    /**
     * Meta batches: one POST can carry many messages and many status
     * updates across several `entry[]`/`changes[]`. The Communications OS
     * event pipeline is one-fact-in / one-record-out and dedupes on
     * `externalEventId`, so the batch is split into single-fact envelopes
     * here and each flows through the unchanged pipeline. Splitting
     * rather than "process the first one" is the difference between
     * recording every reply and silently dropping all but one.
     */
    if (provider === "whatsapp_cloud_api") {
      const envelopes = splitWhatsAppWebhookPayload(payload);
      const outcomes: ProcessOutcome[] = [];
      for (const envelope of envelopes) {
        outcomes.push(
          await processInboundProviderEvent(db, {
            organizationId: connection.organizationId,
            connectionId: connection.id,
            provider,
            externalEventId: envelope.externalEventId,
            eventType: envelope.eventType,
            rawPayload: envelope.payload,
          })
        );
      }
      // Always 200 once the signature is valid. Meta retries a non-2xx for
      // up to seven days and will disable the subscription on sustained
      // failure; a payload we could not map is our problem to reconcile,
      // not a reason to have Meta replay the whole batch forever.
      return jsonSuccess({
        received: envelopes.length,
        processed: outcomes.filter((o) => o === "processed").length,
        duplicates: outcomes.filter((o) => o === "duplicate").length,
        ignored: outcomes.filter((o) => o === "ignored").length,
        failed: outcomes.filter((o) => o === "failed").length,
      });
    }

    const payloadObject = payload as { type?: string; externalEventId?: string; id?: string };
    const externalEventId = payloadObject.externalEventId ?? payloadObject.id ?? `${provider}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const eventType = payloadObject.type ?? "unknown";

    const outcome = await processInboundProviderEvent(db, { organizationId: connection.organizationId, connectionId: connection.id, provider, externalEventId, eventType, rawPayload: payload });

    return jsonSuccess({ outcome });
  } catch (err) {
    return handleRouteError(err);
  }
}
