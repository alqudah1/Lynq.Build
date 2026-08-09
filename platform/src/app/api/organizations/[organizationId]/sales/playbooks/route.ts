import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { createPlaybook, listPlaybooksForUser } from "@/lib/sales-os/playbooks";
import { salesKeySchema, salesNameSchema, salesPlaybookTypeSchema } from "@/lib/sales-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const createPlaybookBodySchema = z.object({ name: salesNameSchema, playbookKey: salesKeySchema, playbookType: salesPlaybookTypeSchema, workspaceId: z.string().uuid().optional() }).strict();

/** GET /api/organizations/{organizationId}/sales/playbooks?playbookType= */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const playbookType = z.union([salesPlaybookTypeSchema, z.undefined()]).parse(url.searchParams.get("playbookType") ?? undefined);

    const playbooks = await listPlaybooksForUser(db, { organizationId, playbookType, actorUserId: user.userId });
    return jsonSuccess({ playbooks });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/sales/playbooks */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createPlaybookBodySchema);
    const result = await createPlaybook(db, { organizationId, actorUserId: user.userId, ...body });
    return jsonSuccess(result, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
