import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { createManagerThread, listManagerThreads } from "@/lib/social-os/manager";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const createBodySchema = z.object({ brandProfileId: z.string().uuid().nullable().optional(), title: z.string().trim().max(200).optional() }).strict();

/** GET /api/organizations/{organizationId}/social/manager/threads?brandProfileId= — the caller's own threads. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const brandParam = new URL(request.url).searchParams.get("brandProfileId");
    const threads = await listManagerThreads(db, { organizationId, actorUserId: user.userId, brandProfileId: brandParam ? parseUuidParam(brandParam) : undefined });
    return jsonSuccess({ threads });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/social/manager/threads */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, createBodySchema);
    const thread = await createManagerThread(db, { organizationId, actorUserId: user.userId, ...body });
    return jsonSuccess(thread, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
