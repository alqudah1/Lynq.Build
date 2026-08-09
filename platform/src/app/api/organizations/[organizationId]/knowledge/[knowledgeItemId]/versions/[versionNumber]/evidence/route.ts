import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { evidenceClassSchema, evidenceDescriptionSchema, externalReferenceSchema, trustTierSchema, versionNumberSchema, knowledgeListLimitSchema } from "@/lib/brain/validation";
import { createEvidence, listEvidenceForVersion } from "@/lib/brain/evidence";

export const dynamic = "force-dynamic";

const createEvidenceBodySchema = z
  .object({
    evidenceClass: evidenceClassSchema,
    description: evidenceDescriptionSchema,
    externalReference: externalReferenceSchema.optional(),
    evidenceTrustTier: trustTierSchema,
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; knowledgeItemId: string; versionNumber: string }> };

/**
 * GET /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/versions/{versionNumber}/evidence
 * Lists a version's evidence, newest first. Bounded, cursor-paginated
 * (never offset-based).
 *
 * Query params: cursor?, limit? (default 20, max 100)
 *
 * 200 response:
 * { "data": { "evidence": [ { "id": "...", "evidenceClass": "primary", "description": "...", "externalReference": null, "evidenceTrustTier": "verified", "isStale": false, "createdByUserId": "...", "createdAt": "..." } ], "nextCursor": "..." | null } }
 *
 * Errors: 400 invalid_request, 401 unauthenticated, 404 not_found
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, knowledgeItemId: rawKnowledgeItemId, versionNumber: rawVersionNumber } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const knowledgeItemId = parseUuidParam(rawKnowledgeItemId);
    const versionNumber = versionNumberSchema.parse(rawVersionNumber);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const query = z
      .object({ cursor: z.string().optional(), limit: knowledgeListLimitSchema.optional() })
      .parse({ cursor: url.searchParams.get("cursor") ?? undefined, limit: url.searchParams.get("limit") ?? undefined });

    const result = await listEvidenceForVersion(db, {
      organizationId,
      knowledgeItemId,
      versionNumber,
      actorUserId: user.userId,
      cursor: query.cursor ?? null,
      limit: query.limit,
    });

    return jsonSuccess(result);
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/versions/{versionNumber}/evidence
 * Adds one new evidence row to a version — append-only, never an update to
 * existing evidence. Requires ordinary content-edit authority (`edit_any_draft`,
 * or `edit_own_draft` while the actor is the item's own author — the same
 * bar as updating the item itself) — a deliberately lower bar than the
 * trust route's `approve` capability requirement.
 *
 * Body: { "evidenceClass": string, "description": string, "externalReference"?: string, "evidenceTrustTier": string }
 *
 * 201 response: { "data": { "id": "...", "evidenceClass": "primary", ... } }
 *
 * Errors:
 * 400 invalid_request
 * 401 unauthenticated
 * 403 forbidden
 * 404 not_found
 * 409 item_archived
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, knowledgeItemId: rawKnowledgeItemId, versionNumber: rawVersionNumber } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const knowledgeItemId = parseUuidParam(rawKnowledgeItemId);
    const versionNumber = versionNumberSchema.parse(rawVersionNumber);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createEvidenceBodySchema);

    const evidence = await createEvidence(db, {
      organizationId,
      knowledgeItemId,
      versionNumber,
      evidenceClass: body.evidenceClass,
      description: body.description,
      externalReference: body.externalReference ?? null,
      evidenceTrustTier: body.evidenceTrustTier,
      actorUserId: user.userId,
    });

    return jsonSuccess(evidence, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
