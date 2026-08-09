import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { addPlaybookStep, listPlaybookSteps } from "@/lib/sales-os/playbooks";
import { salesKeySchema, salesNameSchema, salesPlaybookStepTypeSchema, salesDescriptionSchema } from "@/lib/sales-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; playbookId: string; versionId: string }> };

const addStepBodySchema = z
  .object({ stepKey: salesKeySchema, stepType: salesPlaybookStepTypeSchema, name: salesNameSchema, description: salesDescriptionSchema, sequence: z.number().int().min(0), configuration: z.record(z.string(), z.unknown()).optional(), required: z.boolean().optional() })
  .strict();

/** GET /api/organizations/{organizationId}/sales/playbooks/{playbookId}/versions/{versionId}/steps */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, versionId: rawVersion } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const versionId = parseUuidParam(rawVersion);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const steps = await listPlaybookSteps(db, { organizationId, playbookVersionId: versionId, actorUserId: user.userId });
    return jsonSuccess({ steps });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/sales/playbooks/{playbookId}/versions/{versionId}/steps */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, versionId: rawVersion } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const versionId = parseUuidParam(rawVersion);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, addStepBodySchema);
    const step = await addPlaybookStep(db, { organizationId, playbookVersionId: versionId, actorUserId: user.userId, ...body });
    return jsonSuccess(step, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
