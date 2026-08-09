import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { createFollowUpSequence, listSequencesForUser, enrollInSequence } from "@/lib/sales-os/sequences";
import { salesKeySchema, salesNameSchema, salesSequenceTargetTypeSchema } from "@/lib/sales-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const createSequenceBodySchema = z.object({ name: salesNameSchema, sequenceKey: salesKeySchema, targetType: salesSequenceTargetTypeSchema, workspaceId: z.string().uuid().optional() }).strict();
const enrollBodySchema = z.object({ sequenceId: z.string().uuid(), targetType: salesSequenceTargetTypeSchema, targetId: z.string().uuid() }).strict();

/** GET /api/organizations/{organizationId}/sales/sequences?targetType= */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const targetType = salesSequenceTargetTypeSchema.optional().parse(url.searchParams.get("targetType") ?? undefined);

    const sequences = await listSequencesForUser(db, { organizationId, targetType, actorUserId: user.userId });
    return jsonSuccess({ sequences });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/sales/sequences — create a sequence, or enroll a target if `action=enroll` is set. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    if (url.searchParams.get("action") === "enroll") {
      const body = await parseJsonBody(request, enrollBodySchema);
      const enrollment = await enrollInSequence(db, { organizationId, actorUserId: user.userId, ...body });
      return jsonSuccess(enrollment, 201);
    }

    const body = await parseJsonBody(request, createSequenceBodySchema);
    const result = await createFollowUpSequence(db, { organizationId, actorUserId: user.userId, ...body });
    return jsonSuccess(result, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
