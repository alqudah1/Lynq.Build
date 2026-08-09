import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { createTemplateVersion } from "@/lib/communications-os/templates";
import { templateVariableSchemaArray } from "@/lib/communications-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; templateId: string }> };
const bodySchema = z.object({ subjectTemplate: z.string().trim().max(300).optional(), bodyTemplate: z.string().trim().min(1).max(20000), variableSchema: templateVariableSchemaArray.optional() }).strict();

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, templateId: rawTemplate } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const templateId = parseUuidParam(rawTemplate);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);
    const version = await createTemplateVersion(db, { organizationId, templateId, actorUserId: user.userId, ...body });
    return jsonSuccess(version, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
