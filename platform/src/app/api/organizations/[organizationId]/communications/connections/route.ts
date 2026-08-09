import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, nameSchema } from "@/lib/http/validation";
import { createConnection, listConnectionsForUser } from "@/lib/communications-os/connections";
import { INTEGRATION_PROVIDERS, COMMUNICATION_CHANNELS } from "@/lib/communications-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const createConnectionBodySchema = z
  .object({
    provider: z.enum(INTEGRATION_PROVIDERS),
    integrationType: z.enum(COMMUNICATION_CHANNELS),
    displayName: nameSchema,
    workspaceId: z.string().uuid().optional(),
  })
  .strict();

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const connections = await listConnectionsForUser(db, { organizationId, actorUserId: user.userId });
    return jsonSuccess({ connections });
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
    const body = await parseJsonBody(request, createConnectionBodySchema);
    const connection = await createConnection(db, { organizationId, actorUserId: user.userId, ...body });
    return jsonSuccess(connection, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
