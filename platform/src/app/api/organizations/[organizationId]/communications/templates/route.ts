import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, nameSchema } from "@/lib/http/validation";
import { createTemplate, listTemplatesForUser } from "@/lib/communications-os/templates";
import { COMMUNICATION_CHANNELS, templateKeySchema, templateVariableSchemaArray } from "@/lib/communications-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const createTemplateBodySchema = z
  .object({
    channel: z.enum(COMMUNICATION_CHANNELS),
    name: nameSchema,
    templateKey: templateKeySchema,
    purpose: z.string().trim().max(500).optional(),
    subjectTemplate: z.string().trim().max(300).optional(),
    bodyTemplate: z.string().trim().min(1).max(20000),
    variableSchema: templateVariableSchemaArray.optional(),
    workspaceId: z.string().uuid().optional(),
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
    const channelParam = url.searchParams.get("channel");
    const channel = channelParam ? z.enum(COMMUNICATION_CHANNELS).parse(channelParam) : undefined;
    const templates = await listTemplatesForUser(db, { organizationId, channel, actorUserId: user.userId });
    return jsonSuccess({ templates });
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
    const body = await parseJsonBody(request, createTemplateBodySchema);
    const result = await createTemplate(db, { organizationId, actorUserId: user.userId, ...body });
    return jsonSuccess(result, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
