import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { createPlaybook, listPlaybooksForUser } from "@/lib/marketing-os/playbooks";
import { marketingKeySchema, marketingNameSchema, marketingPlaybookTypeSchema } from "@/lib/marketing-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const createPlaybookBodySchema = z.object({ name: marketingNameSchema, playbookKey: marketingKeySchema, playbookType: marketingPlaybookTypeSchema, workspaceId: z.string().uuid().optional() }).strict();

/** GET /api/organizations/{organizationId}/marketing/playbooks?playbookType= */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const playbookTypeParam = url.searchParams.get("playbookType");
    const playbookType = playbookTypeParam ? marketingPlaybookTypeSchema.parse(playbookTypeParam) : undefined;

    const playbooks = await listPlaybooksForUser(db, { organizationId, actorUserId: user.userId, playbookType });
    return jsonSuccess({ playbooks });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/marketing/playbooks */
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
