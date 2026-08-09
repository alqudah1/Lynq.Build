import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { resolveConnectionById } from "@/lib/communications-os/connections";
import { processInboundProviderEvent } from "@/lib/communications-os/webhooks";
import { verifyResendWebhookSignature } from "@/lib/communications-os/providers/resend";
import { timingSafeEqualStrings } from "@/lib/communications-os/secrets";
import { INTEGRATION_PROVIDERS, type IntegrationProvider } from "@/lib/communications-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ provider: string; connectionId: string }> };

/**
 * ============================================================================
 * Provider webhook ingestion — Module 16
 * ============================================================================
 * Dedicated, unauthenticated-by-session route — a real provider cannot
 * carry a human session cookie. Authenticity comes from a provider-
 * specific signature check (Resend's Svix HMAC) or, for the development
 * providers, a shared bearer secret — never from `getAuthenticatedUser`.
 *
 * One deliberate refinement beyond the spec's own literal
 * `/api/integrations/:provider/webhook` suggestion: this path also
 * carries `connectionId`. A provider-only path cannot resolve which of
 * potentially many organizations' connections a given webhook belongs to
 * — each connection has its own unique webhook URL (shown on its detail
 * page), the realistic multi-tenant shape any real ESP integration needs.
 * A single, platform-wide Resend account is assumed for v1 (one
 * `RESEND_WEBHOOK_SECRET`); a future module supporting one Resend account
 * PER organization would additionally store a per-connection signing
 * secret rather than a single env var.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { provider: rawProvider, connectionId: rawConnectionId } = await params;
    if (!(INTEGRATION_PROVIDERS as readonly string[]).includes(rawProvider)) {
      return Response.json({ error: { code: "unknown_provider", message: "Unknown provider", requestId: crypto.randomUUID() } }, { status: 404 });
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
      return Response.json({ error: { code: "not_found", message: "Unknown connection", requestId: crypto.randomUUID() } }, { status: 404 });
    }

    const rawBody = await request.text();

    if (provider === "resend") {
      const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
      const svixId = request.headers.get("svix-id");
      const svixTimestamp = request.headers.get("svix-timestamp");
      const svixSignature = request.headers.get("svix-signature");
      if (!webhookSecret || !svixId || !svixTimestamp || !svixSignature) {
        return Response.json({ error: { code: "unauthenticated_webhook", message: "Missing signature", requestId: crypto.randomUUID() } }, { status: 401 });
      }
      const valid = verifyResendWebhookSignature({ webhookSecret, svixId, svixTimestamp, rawBody, svixSignatureHeader: svixSignature });
      if (!valid) {
        return Response.json({ error: { code: "invalid_webhook_signature", message: "Signature verification failed", requestId: crypto.randomUUID() } }, { status: 401 });
      }
    } else if (provider === "dev_email" || provider === "dev_sms" || provider === "dev_whatsapp") {
      const devSecret = process.env.COMMUNICATIONS_DEV_WEBHOOK_SECRET;
      const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (!devSecret || !provided || !timingSafeEqualStrings(provided, devSecret)) {
        return Response.json({ error: { code: "unauthenticated_webhook", message: "Missing or invalid dev webhook secret", requestId: crypto.randomUUID() } }, { status: 401 });
      }
    } else {
      return Response.json({ error: { code: "provider_not_implemented", message: `No webhook handler for provider "${provider}"`, requestId: crypto.randomUUID() } }, { status: 501 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return Response.json({ error: { code: "invalid_payload", message: "Body is not valid JSON", requestId: crypto.randomUUID() } }, { status: 400 });
    }

    const payloadObject = payload as { type?: string; externalEventId?: string; id?: string };
    const externalEventId = payloadObject.externalEventId ?? payloadObject.id ?? `${provider}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const eventType = payloadObject.type ?? "unknown";

    const connection = await resolveConnectionById(db, connectionRow.organizationId, connectionId);
    const outcome = await processInboundProviderEvent(db, { organizationId: connection.organizationId, connectionId: connection.id, provider, externalEventId, eventType, rawPayload: payload });

    return jsonSuccess({ outcome });
  } catch (err) {
    return handleRouteError(err);
  }
}
