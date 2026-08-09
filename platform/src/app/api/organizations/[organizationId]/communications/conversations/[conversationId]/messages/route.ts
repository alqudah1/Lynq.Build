import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { createDraftMessage, listMessagesForConversation } from "@/lib/communications-os/messages";
import { COMMUNICATION_CHANNELS } from "@/lib/communications-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; conversationId: string }> };

const createDraftBodySchema = z
  .object({
    channel: z.enum(COMMUNICATION_CHANNELS),
    integrationConnectionId: z.string().uuid().optional(),
    recipientReference: z.string().trim().min(1).max(320),
    subject: z.string().trim().max(300).optional(),
    bodyText: z.string().trim().min(1).max(20000),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, conversationId: rawConv } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const conversationId = parseUuidParam(rawConv);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const messages = await listMessagesForConversation(db, { organizationId, conversationId, actorUserId: user.userId });
    return jsonSuccess({ messages });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, conversationId: rawConv } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const conversationId = parseUuidParam(rawConv);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, createDraftBodySchema);
    const message = await createDraftMessage(db, { organizationId, conversationId, actorUserId: user.userId, ...body });
    return jsonSuccess(message, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
