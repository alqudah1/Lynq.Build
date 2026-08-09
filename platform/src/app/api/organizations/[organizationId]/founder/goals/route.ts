import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam, parseJsonBody } from "@/lib/http/validation";
import { createFounderGoal, listFounderGoals } from "@/lib/founder-os/goals";
import { titleSchema } from "@/lib/founder-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const goals = await listFounderGoals(db, { organizationId, actorUserId: user.userId });
    return jsonSuccess({ goals });
  } catch (err) {
    return handleRouteError(err);
  }
}

const createBodySchema = z
  .object({
    workspaceId: z.string().uuid().nullable().optional(),
    title: titleSchema,
    metricKey: z.string().trim().min(1).max(100),
    targetValue: z.number(),
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
    ownerUserId: z.string().uuid(),
    relatedSalesTargetId: z.string().uuid().nullable().optional(),
  })
  .strict();

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createBodySchema);
    const goal = await createFounderGoal(db, { organizationId, actorUserId: user.userId, ...body });
    return jsonSuccess(goal, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
