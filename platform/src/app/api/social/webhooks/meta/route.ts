import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { timingSafeEqualStrings } from "@/lib/communications-os/secrets";
import { verifyMetaSignature, handleMetaWebhookEvent } from "@/lib/social-os/webhooks";

export const dynamic = "force-dynamic";

/**
 * GET /api/social/webhooks/meta — Meta's subscription handshake: echo
 * `hub.challenge` only when `hub.verify_token` matches META_WEBHOOK_VERIFY_TOKEN.
 */
export async function GET(request: Request) {
  const env = loadEnv();
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  if (!env.META_WEBHOOK_VERIFY_TOKEN) return new Response("Not configured", { status: 503 });
  if (mode !== "subscribe" || !timingSafeEqualStrings(token, env.META_WEBHOOK_VERIFY_TOKEN)) return new Response("Forbidden", { status: 403 });
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

/**
 * POST /api/social/webhooks/meta — verifies X-Hub-Signature-256 over the raw
 * body before parsing anything, dedupes, and nudges an engagement sync.
 * 200 once accepted (including events we ignore); 500 only when our own
 * processing failed, so Meta redelivers (deduped on redelivery).
 */
export async function POST(request: Request) {
  const env = loadEnv();
  if (!env.META_APP_SECRET) return new Response("Not configured", { status: 503 });
  const rawBody = await request.text();
  if (!verifyMetaSignature({ appSecret: env.META_APP_SECRET, rawBody, signatureHeader: request.headers.get("x-hub-signature-256") })) {
    return new Response("Invalid signature", { status: 401 });
  }
  try {
    const db = createDbClient(env);
    const result = await handleMetaWebhookEvent(db, { rawPayload: rawBody });
    return Response.json({ ok: true, ...result }, { status: 200 });
  } catch (err) {
    console.error("[social-webhook] meta processing failed:", err instanceof Error ? err.name : "unknown error");
    return new Response("Processing failed", { status: 500 });
  }
}
