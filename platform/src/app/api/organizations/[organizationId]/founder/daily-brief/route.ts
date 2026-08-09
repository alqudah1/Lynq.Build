import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam, parseJsonBody } from "@/lib/http/validation";
import { computeDailyBrief } from "@/lib/founder-os/daily-brief";
import { launchFounderCompanyBriefTask } from "@/lib/founder-os/founder-analyst";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const querySchema = z.object({ workspaceId: z.string().uuid().optional() });

/** GET /api/organizations/{organizationId}/founder/daily-brief — the deterministic brief computed live (no artifact, no agent execution). */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const parsed = querySchema.parse(Object.fromEntries(url.searchParams));

    const brief = await computeDailyBrief(db, { organizationId, workspaceId: parsed.workspaceId ?? null, actorUserId: user.userId });
    return jsonSuccess(brief);
  } catch (err) {
    return handleRouteError(err);
  }
}

const launchBodySchema = z.object({ workspaceId: z.string().uuid().nullable().optional() }).strict().default({});

/** POST /api/organizations/{organizationId}/founder/daily-brief — launches the Founder Analyst agent's real task, producing a durable `report` artifact. Idempotent within a calendar day. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const parsed = await parseJsonBody(request, launchBodySchema);

    const result = await launchFounderCompanyBriefTask(db, { organizationId, workspaceId: parsed.workspaceId ?? null, ownerUserId: user.userId, actorUserId: user.userId });
    return jsonSuccess(result, result.reusedExisting ? 200 : 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
