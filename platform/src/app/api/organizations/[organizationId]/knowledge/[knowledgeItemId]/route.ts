import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { knowledgeClassificationSchema, knowledgeTitleSchema, knowledgeContentSchema, versionNumberSchema, changeReasonSchema } from "@/lib/brain/validation";
import { getKnowledgeItemForUser, updateKnowledgeItem } from "@/lib/brain/knowledge-items";

export const dynamic = "force-dynamic";

const updateKnowledgeItemBodySchema = z
  .object({
    expectedVersionNumber: versionNumberSchema,
    title: knowledgeTitleSchema.optional(),
    content: knowledgeContentSchema.optional(),
    classification: knowledgeClassificationSchema.optional(),
    changeReason: changeReasonSchema.optional(),
  })
  .strict()
  .refine((data) => data.title !== undefined || data.content !== undefined || data.classification !== undefined, {
    message: "at least one of title, content, or classification must be provided",
  });

type RouteParams = { params: Promise<{ organizationId: string; knowledgeItemId: string }> };

/**
 * GET /api/organizations/{organizationId}/knowledge/{knowledgeItemId}
 * Fetches one knowledge item. Organization membership is required; a
 * workspace-scoped item additionally requires explicit membership in that
 * exact workspace — organization role, including owner/admin, never
 * overrides this.
 *
 * 200 response: { "data": { "id": "...", ... } }
 *
 * Errors: 401 unauthenticated, 404 not_found (nonexistent, cross-tenant, or workspace-scoped without explicit workspace membership — all identical)
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, knowledgeItemId: rawKnowledgeItemId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const knowledgeItemId = parseUuidParam(rawKnowledgeItemId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const item = await getKnowledgeItemForUser(db, organizationId, knowledgeItemId, user.userId);
    return jsonSuccess(item);
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * PATCH /api/organizations/{organizationId}/knowledge/{knowledgeItemId}
 * Updates a knowledge item's title/content/classification by creating a new
 * immutable version (Brain Module 2) — never overwrites in place. `domain`
 * is no longer updatable via this route (it is a stable ownership/
 * permission boundary, not content — see `knowledgeItems`' schema comment).
 * Requires the `edit_any_draft` Brain-domain capability at this exact
 * scope, or `edit_own_draft` while the actor is the item's own author
 * (Module 7 — an explicit grant, never an organization/workspace role).
 * Protected against lost updates via `expectedVersionNumber` (optimistic
 * concurrency) — a stale value is rejected, never silently overwritten.
 *
 * Body: { "expectedVersionNumber": number, "title"?: string, "content"?: string, "classification"?: string, "changeReason"?: string }
 *
 * 200 response: { "data": { "id": "...", "currentVersionNumber": 2, ... } }
 *
 * Errors:
 * 400 invalid_request
 * 401 unauthenticated
 * 403 forbidden — lacks `edit_any_draft`, and (if not the author) lacks `edit_own_draft`
 * 404 not_found
 * 409 version_conflict — expectedVersionNumber no longer matches; 409 item_archived — cannot update an archived item
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, knowledgeItemId: rawKnowledgeItemId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const knowledgeItemId = parseUuidParam(rawKnowledgeItemId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, updateKnowledgeItemBodySchema);
    const { expectedVersionNumber, changeReason, ...updates } = body;

    const item = await updateKnowledgeItem(db, {
      organizationId,
      knowledgeItemId,
      actorUserId: user.userId,
      expectedVersionNumber,
      updates,
      changeReason: changeReason ?? null,
    });

    return jsonSuccess(item);
  } catch (err) {
    return handleRouteError(err);
  }
}
