import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { upsertConsent, listConsentRecordsForUser } from "@/lib/communications-os/consent";
import { COMMUNICATION_CHANNELS, COMMUNICATION_CONSENT_STATUSES, COMMUNICATION_CONSENT_SOURCES } from "@/lib/communications-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };
const bodySchema = z
  .object({
    channel: z.enum(COMMUNICATION_CHANNELS),
    rawIdentity: z.string().trim().min(1).max(320),
    contactId: z.string().uuid().nullable().optional(),
    consentStatus: z.enum(COMMUNICATION_CONSENT_STATUSES),
    consentSource: z.enum(COMMUNICATION_CONSENT_SOURCES),
  })
  .strict();

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const records = await listConsentRecordsForUser(db, { organizationId, actorUserId: user.userId });
    return jsonSuccess({ records });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);
    const record = await upsertConsent(db, { organizationId, actorUserId: user.userId, ...body });
    return jsonSuccess(record, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
