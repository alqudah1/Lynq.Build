import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { publishTemplateVersion } from "@/lib/communications-os/templates";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; templateId: string; versionId: string }> };
const bodySchema = z.object({ expectedRevision: z.number().int().min(1) }).strict();

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, templateId: rawTemplate, versionId: rawVersion } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const templateId = parseUuidParam(rawTemplate);
    const versionId = parseUuidParam(rawVersion);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);
    const version = await publishTemplateVersion(db, { organizationId, templateId, versionId, expectedRevision: body.expectedRevision, actorUserId: user.userId });
    return jsonSuccess(version);
  } catch (err) {
    return handleRouteError(err);
  }
}
