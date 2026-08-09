import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { addSalesTeamMember, listSalesTeamMembers } from "@/lib/sales-os/teams";
import { salesTeamMemberRoleSchema } from "@/lib/sales-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; teamId: string }> };

const addMemberBodySchema = z.object({ userId: z.string().uuid(), teamRole: salesTeamMemberRoleSchema.optional() }).strict();

/** GET /api/organizations/{organizationId}/sales/teams/{teamId}/members */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, teamId: rawTeam } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const teamId = parseUuidParam(rawTeam);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const members = await listSalesTeamMembers(db, { organizationId, teamId, actorUserId: user.userId });
    return jsonSuccess({ members });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/sales/teams/{teamId}/members */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, teamId: rawTeam } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const teamId = parseUuidParam(rawTeam);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, addMemberBodySchema);
    const member = await addSalesTeamMember(db, { organizationId, teamId, actorUserId: user.userId, ...body });
    return jsonSuccess(member, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
