import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { findOrCreateConversation, listConversationsForUser } from "@/lib/communications-os/conversations";
import { COMMUNICATION_CHANNELS, COMMUNICATION_CONVERSATION_STATUSES } from "@/lib/communications-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const createConversationBodySchema = z
  .object({
    channel: z.enum(COMMUNICATION_CHANNELS),
    workspaceId: z.string().uuid().optional(),
    integrationConnectionId: z.string().uuid().optional(),
    contactId: z.string().uuid().nullable().optional(),
    companyId: z.string().uuid().nullable().optional(),
    leadId: z.string().uuid().nullable().optional(),
    opportunityId: z.string().uuid().nullable().optional(),
    externalThreadId: z.string().trim().max(300).nullable().optional(),
    assignedUserId: z.string().uuid().nullable().optional(),
  })
  .strict();

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    const status = statusParam ? z.enum(COMMUNICATION_CONVERSATION_STATUSES).parse(statusParam) : undefined;
    const conversations = await listConversationsForUser(db, { organizationId, status, actorUserId: user.userId });
    return jsonSuccess({ conversations });
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
    const body = await parseJsonBody(request, createConversationBodySchema);
    const conversation = await findOrCreateConversation(db, { organizationId, actorUserId: user.userId, ...body });
    return jsonSuccess(conversation, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
