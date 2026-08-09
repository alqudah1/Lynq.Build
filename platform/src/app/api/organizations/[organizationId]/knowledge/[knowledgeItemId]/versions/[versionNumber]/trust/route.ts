import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { trustTierSchema, sourceTypeSchema, sourceDetailSchema, trustRevisionSchema, versionNumberSchema } from "@/lib/brain/validation";
import { getTrustAssessmentForVersion, attachTrustMetadata } from "@/lib/brain/trust";

export const dynamic = "force-dynamic";

const attachTrustMetadataBodySchema = z
  .object({
    trustTier: trustTierSchema,
    expectedRevision: trustRevisionSchema,
    sourceType: sourceTypeSchema,
    sourceDetail: sourceDetailSchema.optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; knowledgeItemId: string; versionNumber: string }> };

/**
 * GET /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/versions/{versionNumber}/trust
 * Retrieves the combined Trust + Source view for one version. A version
 * with no assessment yet returns `trust: { trustTier: "unknown", revision: 0, ... }`
 * and `source: null` — never a 404 for "not yet assessed."
 *
 * 200 response:
 * { "data": { "knowledgeItemId": "...", "versionNumber": 2, "trust": { "trustTier": "approved", "revision": 1, "lastAssessedByUserId": "...", "assessedAt": "..." }, "source": { "sourceType": "founder_decision", "sourceDetail": "...", "recordedByUserId": "...", "recordedAt": "..." } } }
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

    const view = await getTrustAssessmentForVersion(db, organizationId, knowledgeItemId, versionNumber, user.userId);
    return jsonSuccess(view);
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/versions/{versionNumber}/trust
 * Attaches (first call) or reassesses (every later call) a version's trust
 * tier, together with its Source. Requires the `approve` Brain-domain
 * capability at this exact scope (`requireBrainApproveAccess`, Module 7) —
 * a strictly higher bar than ordinary content-edit authority, never
 * substitutable by authorship or any organization/workspace role.
 * `sourceType` is always required; once recorded it is immutable — a later
 * call supplying a different `sourceType` is rejected, never silently
 * changed.
 *
 * Body: { "trustTier": string, "expectedRevision": number, "sourceType": string, "sourceDetail"?: string }
 * `expectedRevision: 0` means "I believe no assessment exists yet."
 *
 * 200 response: same shape as GET.
 *
 * Errors:
 * 400 invalid_request
 * 401 unauthenticated
 * 403 forbidden — lacks the `approve` capability at this scope
 * 404 not_found — not an organization/workspace member
 * 409 trust_conflict — expectedRevision no longer matches; 409 source_immutable — sourceType differs from what's already recorded; 409 item_archived
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

    const body = await parseJsonBody(request, attachTrustMetadataBodySchema);

    const view = await attachTrustMetadata(db, {
      organizationId,
      knowledgeItemId,
      versionNumber,
      trustTier: body.trustTier,
      expectedRevision: body.expectedRevision,
      sourceType: body.sourceType,
      sourceDetail: body.sourceDetail ?? null,
      actorUserId: user.userId,
    });

    return jsonSuccess(view);
  } catch (err) {
    return handleRouteError(err);
  }
}
