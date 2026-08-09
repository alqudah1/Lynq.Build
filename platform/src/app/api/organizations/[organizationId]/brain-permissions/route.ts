import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { knowledgeDomainSchema, brainCapabilitySchema, grantReasonSchema } from "@/lib/brain/validation";
import { createBrainPermissionGrant, listBrainPermissionGrants } from "@/lib/brain/permissions";

export const dynamic = "force-dynamic";

/**
 * Brain Module 16 — exactly one of `granteeUserId`/`granteeAgentId` in the
 * request body, matching `createBrainPermissionGrant`'s own closed
 * `BrainPermissionGrantee` union. `.strict()` plus this refinement is what
 * rejects a body naming both or neither, before the domain layer ever runs.
 */
const createGrantBodySchema = z
  .object({
    domain: knowledgeDomainSchema,
    workspaceId: uuidParam.optional(),
    granteeUserId: uuidParam.optional(),
    granteeAgentId: uuidParam.optional(),
    capability: brainCapabilitySchema,
    reason: grantReasonSchema.optional(),
  })
  .strict()
  .refine((body) => Boolean(body.granteeUserId) !== Boolean(body.granteeAgentId), {
    message: "Exactly one of granteeUserId or granteeAgentId is required",
  });

type RouteParams = { params: Promise<{ organizationId: string }> };

/**
 * GET /api/organizations/{organizationId}/brain-permissions
 * Lists this organization's Brain permission grants — organization owner/
 * admin only (read-only oversight; see `listBrainPermissionGrants`'s own
 * doc comment for why this is gated less strictly than creating a grant).
 *
 * Query params: granteeUserId?, granteeAgentId?, domain?, workspaceId?
 * ("null" means organization-scoped grants only; omitted means no
 * workspace filter at all), includeRevoked? (default false)
 *
 * 200 response: { "data": [ { "id": "...", "organizationId": "...", "domain": "execution", "workspaceId": null, "granteeUserId": "...", "capability": "read", "revision": 1, "reason": null, "revokedAt": null, ... } ] }
 *
 * Errors: 400 invalid_request, 401 unauthenticated, 403 forbidden — not an organization owner/admin, 404 not_found — not an organization member
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const rawWorkspaceId = url.searchParams.get("workspaceId");
    const query = z
      .object({
        granteeUserId: uuidParam.optional(),
        granteeAgentId: uuidParam.optional(),
        domain: knowledgeDomainSchema.optional(),
        includeRevoked: z.enum(["true", "false"]).optional(),
      })
      .parse({
        granteeUserId: url.searchParams.get("granteeUserId") ?? undefined,
        granteeAgentId: url.searchParams.get("granteeAgentId") ?? undefined,
        domain: url.searchParams.get("domain") ?? undefined,
        includeRevoked: url.searchParams.get("includeRevoked") ?? undefined,
      });

    const grants = await listBrainPermissionGrants(db, {
      organizationId,
      actorUserId: user.userId,
      granteeUserId: query.granteeUserId,
      granteeAgentId: query.granteeAgentId,
      domain: query.domain,
      workspaceId: rawWorkspaceId === null ? undefined : rawWorkspaceId === "null" ? null : parseUuidParam(rawWorkspaceId),
      includeRevoked: query.includeRevoked === "true",
    });

    return jsonSuccess(grants);
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/organizations/{organizationId}/brain-permissions
 * Creates one active Brain permission grant. Requires grant-management
 * authority (organization owner for an organization-scoped grant;
 * organization owner or admin for a workspace-scoped one) AND that the
 * actor themselves already holds the requested capability at the
 * organization level for this domain ("cannot grant a capability you
 * aren't authorized to assign" — see `createBrainPermissionGrant`'s own
 * doc comment for the full reasoning). The grantee must already be an
 * organization member, and — for a workspace-scoped grant — a member of
 * that exact workspace too.
 *
 * Body: { "domain": string, "workspaceId"?: string (UUID, omit for an organization-scoped grant), "granteeUserId": string (UUID), "capability": string, "reason"?: string }
 *
 * 201 response: { "data": { "id": "...", "domain": "execution", "workspaceId": null, "granteeUserId": "...", "capability": "read", ... } }
 *
 * Errors:
 * 400 invalid_request
 * 401 unauthenticated
 * 403 forbidden — actor lacks grant-management authority at this scope
 * 404 not_found — actor not an organization member, or workspaceId names a workspace outside this organization
 * 409 grantee_not_organization_member / grantee_not_workspace_member
 * 409 cannot_grant_unauthorized_capability — actor does not themselves hold this capability at the organization level for this domain
 * 409 duplicate_grant — an identical active grant already exists at this exact scope
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createGrantBodySchema);

    const grant = await createBrainPermissionGrant(db, {
      organizationId,
      domain: body.domain,
      workspaceId: body.workspaceId ?? null,
      grantee: body.granteeUserId ? { type: "human", userId: body.granteeUserId } : { type: "agent", agentId: body.granteeAgentId! },
      capability: body.capability,
      reason: body.reason ?? null,
      actorUserId: user.userId,
    });

    return jsonSuccess(grant, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
