import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { listAutomationRules, upsertAutomationRule } from "@/lib/social-os/automation";
import { socialAutomationConfigSchema, socialAutomationKindSchema } from "@/lib/social-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const bodySchema = z
  .object({
    brandProfileId: z.string().uuid().nullable(),
    kind: socialAutomationKindSchema,
    name: z.string().trim().max(200).optional(),
    enabled: z.boolean(),
    intervalMinutes: z.number().int().min(1).max(60 * 24 * 31).optional(),
    config: socialAutomationConfigSchema.optional(),
  })
  .strict();

/** GET /api/organizations/{organizationId}/social/automation — rules with their recent runs. */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const result = await listAutomationRules(db, { organizationId, actorUserId: user.userId });
    return jsonSuccess(result);
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/social/automation — create or update the rule for (brand scope, kind). */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);
    const rule = await upsertAutomationRule(db, { organizationId, actorUserId: user.userId, ...body });
    return jsonSuccess(rule);
  } catch (err) {
    return handleRouteError(err);
  }
}
