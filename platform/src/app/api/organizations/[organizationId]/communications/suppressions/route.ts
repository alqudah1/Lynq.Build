import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { suppressIdentity, listSuppressionsForUser } from "@/lib/communications-os/consent";
import { COMMUNICATION_CHANNELS, COMMUNICATION_SUPPRESSION_REASONS } from "@/lib/communications-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };
const bodySchema = z.object({ channel: z.enum(COMMUNICATION_CHANNELS), rawIdentity: z.string().trim().min(1).max(320), suppressionReason: z.enum(COMMUNICATION_SUPPRESSION_REASONS), source: z.string().trim().max(200).optional() }).strict();

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const suppressions = await listSuppressionsForUser(db, { organizationId, actorUserId: user.userId });
    return jsonSuccess({ suppressions });
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
    const suppression = await suppressIdentity(db, { organizationId, actorUserId: user.userId, ...body });
    return jsonSuccess(suppression, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
