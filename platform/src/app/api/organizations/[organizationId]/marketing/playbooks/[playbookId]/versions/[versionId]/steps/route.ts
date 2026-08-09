import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { addPlaybookStep, listPlaybookSteps } from "@/lib/marketing-os/playbooks";
import { marketingPlaybookStepTypeSchema } from "@/lib/marketing-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; playbookId: string; versionId: string }> };

const addStepBodySchema = z
  .object({
    stepKey: z.string().trim().min(1).max(60),
    stepType: marketingPlaybookStepTypeSchema,
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    sequence: z.number().int().min(0),
    configuration: z.record(z.string(), z.unknown()).optional(),
    required: z.boolean().optional(),
  })
  .strict();

/** GET /api/organizations/{organizationId}/marketing/playbooks/{playbookId}/versions/{versionId}/steps */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, versionId: rawVersion } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const playbookVersionId = parseUuidParam(rawVersion);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const steps = await listPlaybookSteps(db, { organizationId, playbookVersionId, actorUserId: user.userId });
    return jsonSuccess({ steps });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/marketing/playbooks/{playbookId}/versions/{versionId}/steps */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, versionId: rawVersion } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const playbookVersionId = parseUuidParam(rawVersion);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, addStepBodySchema);
    const step = await addPlaybookStep(db, { organizationId, playbookVersionId, actorUserId: user.userId, ...body });
    return jsonSuccess(step, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
