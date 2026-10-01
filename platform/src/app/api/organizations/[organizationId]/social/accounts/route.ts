import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { listAccountsForBrand, createManualAccount } from "@/lib/social-os/connections";
import { socialPlatformSchema } from "@/lib/social-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const createManualAccountBodySchema = z
  .object({
    brandProfileId: z.string().uuid(),
    platform: socialPlatformSchema,
    displayName: z.string().trim().min(1).max(200),
    handle: z.string().trim().max(200).nullable().optional(),
    externalUrl: z.string().trim().url().max(2000).nullable().optional(),
  })
  .strict();

/** GET /api/organizations/{organizationId}/social/accounts?brandProfileId=&includeArchived= */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const url = new URL(request.url);
    const brandProfileId = parseUuidParam(url.searchParams.get("brandProfileId") ?? "");
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    const accounts = await listAccountsForBrand(db, { organizationId, brandProfileId, actorUserId: user.userId, includeArchived });
    return jsonSuccess({ accounts });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/social/accounts — a manually tracked account (no credentials). */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, createManualAccountBodySchema);
    const account = await createManualAccount(db, { organizationId, actorUserId: user.userId, ...body });
    return jsonSuccess(account, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
