import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { createSalesTeam, listSalesTeams } from "@/lib/sales-os/teams";
import { salesKeySchema, salesNameSchema } from "@/lib/sales-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const createTeamBodySchema = z.object({ name: salesNameSchema, teamKey: salesKeySchema, workspaceId: z.string().uuid().optional() }).strict();

/** GET /api/organizations/{organizationId}/sales/teams */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const teams = await listSalesTeams(db, { organizationId, actorUserId: user.userId });
    return jsonSuccess({ teams });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/sales/teams */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createTeamBodySchema);
    const team = await createSalesTeam(db, { organizationId, actorUserId: user.userId, ...body });
    return jsonSuccess(team, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
