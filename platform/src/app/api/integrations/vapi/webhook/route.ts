import "server-only";

import { timingSafeEqualStrings } from "@/lib/communications-os/secrets";

export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BYTES = 1_000_000;
const ALLOWED_EVENT_TYPES = new Set(["status-update", "end-of-call-report", "hang"]);

type VapiServerMessage = {
  message?: {
    type?: string;
    status?: string;
    endedReason?: string;
    call?: {
      id?: string;
      status?: string;
      metadata?: Record<string, unknown>;
    };
    artifact?: {
      transcript?: string;
      messages?: Array<{ role?: string; message?: string }>;
    };
  };
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasTrustedOfficeContext(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.source === "lynq-office"
    && metadata.schemaVersion === 1
    && typeof metadata.organizationId === "string"
    && UUID_PATTERN.test(metadata.organizationId)
    && typeof metadata.ownerUserId === "string"
    && UUID_PATTERN.test(metadata.ownerUserId)
    && typeof metadata.projectId === "string"
    && UUID_PATTERN.test(metadata.projectId);
}

function unauthorized() {
  return Response.json({ error: { code: "unauthorized", message: "Unauthorized" } }, { status: 401 });
}

export async function POST(request: Request) {
  const configuredSecret = process.env.VAPI_WEBHOOK_SECRET;
  const providedSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!configuredSecret || !providedSecret || !timingSafeEqualStrings(providedSecret, configuredSecret)) return unauthorized();

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return Response.json({ error: { code: "payload_too_large", message: "Payload too large" } }, { status: 413 });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) {
    return Response.json({ error: { code: "payload_too_large", message: "Payload too large" } }, { status: 413 });
  }

  let payload: VapiServerMessage;
  try {
    payload = JSON.parse(rawBody) as VapiServerMessage;
  } catch {
    return Response.json({ error: { code: "invalid_payload", message: "Body is not valid JSON" } }, { status: 400 });
  }

  const message = payload.message;
  const eventType = message?.type ?? "unknown";
  if (ALLOWED_EVENT_TYPES.has(eventType)) {
    const userTurnCount = message?.artifact?.messages?.filter(
      (item) => item.role === "user" && Boolean(item.message?.trim()),
    ).length ?? 0;
    console.info("[jarvis-voice]", JSON.stringify({
      event: eventType,
      provider: "vapi",
      providerCallId: message?.call?.id ?? null,
      status: message?.status ?? message?.call?.status ?? null,
      endedReason: message?.endedReason ?? null,
      officeContextPresent: hasTrustedOfficeContext(message?.call?.metadata),
      userTurnCount,
      transcriptBytes: Buffer.byteLength(message?.artifact?.transcript ?? "", "utf8"),
    }));
  }

  return Response.json({ received: true });
}
