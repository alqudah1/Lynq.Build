import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { getTemplateForUser, listTemplateVersions } from "@/lib/communications-os/templates";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; templateId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, templateId: rawTemplate } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const templateId = parseUuidParam(rawTemplate);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const template = await getTemplateForUser(db, { organizationId, templateId, actorUserId: user.userId });
    const versions = await listTemplateVersions(db, { organizationId, templateId, actorUserId: user.userId });
    return jsonSuccess({ template, versions });
  } catch (err) {
    return handleRouteError(err);
  }
}
