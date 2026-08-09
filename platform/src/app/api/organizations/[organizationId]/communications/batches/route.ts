import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, nameSchema } from "@/lib/http/validation";
import { createBulkBatch, listBulkBatchesForUser } from "@/lib/communications-os/bulk";
import { COMMUNICATION_CHANNELS } from "@/lib/communications-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };
const bodySchema = z
  .object({
    name: nameSchema,
    channel: z.enum(COMMUNICATION_CHANNELS),
    campaignId: z.string().uuid().optional(),
    audienceId: z.string().uuid().optional(),
    templateId: z.string().uuid(),
    maxRecipients: z.number().int().min(1).max(2000).optional(),
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
    const batches = await listBulkBatchesForUser(db, { organizationId, actorUserId: user.userId });
    return jsonSuccess({ batches });
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
    const batch = await createBulkBatch(db, { organizationId, actorUserId: user.userId, ...body });
    return jsonSuccess(batch, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
