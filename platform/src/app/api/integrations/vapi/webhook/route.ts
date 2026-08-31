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
    call?: { id?: string; status?: string };
  };
};

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
    console.info("[jarvis-voice]", JSON.stringify({
      event: eventType,
      provider: "vapi",
      providerCallId: message?.call?.id ?? null,
      status: message?.status ?? message?.call?.status ?? null,
      endedReason: message?.endedReason ?? null,
    }));
  }

  return Response.json({ received: true });
}
