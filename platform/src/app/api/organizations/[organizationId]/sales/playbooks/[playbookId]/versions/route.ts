import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { createPlaybookVersion, listPlaybookVersions } from "@/lib/sales-os/playbooks";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; playbookId: string }> };

const createVersionBodySchema = z.object({ changeReason: z.string().trim().max(1000).optional(), cloneFromVersionId: z.string().uuid().optional() }).strict();

/** GET /api/organizations/{organizationId}/sales/playbooks/{playbookId}/versions */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, playbookId: rawPlaybook } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const playbookId = parseUuidParam(rawPlaybook);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const versions = await listPlaybookVersions(db, { organizationId, playbookId, actorUserId: user.userId });
    return jsonSuccess({ versions });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/sales/playbooks/{playbookId}/versions */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, playbookId: rawPlaybook } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const playbookId = parseUuidParam(rawPlaybook);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createVersionBodySchema);
    const version = await createPlaybookVersion(db, { organizationId, playbookId, actorUserId: user.userId, ...body });
    return jsonSuccess(version, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
