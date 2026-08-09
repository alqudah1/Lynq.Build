import "server-only";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import {
  knowledgeDomainSchema,
  knowledgeClassificationSchema,
  knowledgeTitleSchema,
  knowledgeContentSchema,
  knowledgeItemStatusSchema,
  knowledgeListLimitSchema,
} from "@/lib/brain/validation";
import { createKnowledgeItem, listKnowledgeItemsForUser } from "@/lib/brain/knowledge-items";

export const dynamic = "force-dynamic";

const createKnowledgeItemBodySchema = z
  .object({
    workspaceId: uuidParam.optional(),
    domain: knowledgeDomainSchema,
    classification: knowledgeClassificationSchema,
    title: knowledgeTitleSchema,
    content: knowledgeContentSchema,
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string }> };

/**
 * GET /api/organizations/{organizationId}/knowledge
 * Lists knowledge items visible to the authenticated user — bounded,
 * cursor-paginated (never offset-based), filtered only by the essential
 * fields Module 1 supports. Never full-text or semantic search.
 *
 * Query params: workspaceId?, domain?, classification?, status? (default
 * "draft"), cursor?, limit? (default 20, max 100)
 *
 * 200 response:
 * { "data": { "items": [ { "id": "...", "organizationId": "...", "workspaceId": null, "domain": "execution", "classification": "note", "title": "...", "content": "...", "status": "draft", "authorUserId": "...", "currentVersionNumber": 1, "createdAt": "...", "updatedAt": "...", "archivedAt": null } ], "nextCursor": "..." | null } }
 *
 * Errors: 400 invalid_request, 401 unauthenticated, 404 not_found (not an organization member, or workspace filter names a workspace the user isn't explicitly a member of)
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const query = z
      .object({
        workspaceId: uuidParam.optional(),
        domain: knowledgeDomainSchema.optional(),
        classification: knowledgeClassificationSchema.optional(),
        status: knowledgeItemStatusSchema.optional(),
        cursor: z.string().optional(),
        limit: knowledgeListLimitSchema.optional(),
      })
      .parse({
        workspaceId: url.searchParams.get("workspaceId") ?? undefined,
        domain: url.searchParams.get("domain") ?? undefined,
        classification: url.searchParams.get("classification") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
        cursor: url.searchParams.get("cursor") ?? undefined,
        limit: url.searchParams.get("limit") ?? undefined,
      });

    const result = await listKnowledgeItemsForUser(db, {
      organizationId,
      workspaceId: query.workspaceId ?? null,
      domain: query.domain,
      classification: query.classification,
      status: query.status,
      cursor: query.cursor ?? null,
      limit: query.limit,
      actorUserId: user.userId,
    });

    return jsonSuccess(result);
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/organizations/{organizationId}/knowledge
 * Creates a new Draft-status knowledge item. Requires organization
 * membership, explicit workspace membership if workspace-scoped, and the
 * `draft_write` Brain-domain capability at this exact scope — an explicit
 * grant (`src/lib/brain/authz.ts`/`permissions.ts`, Module 7), never
 * inherited from organization or workspace role.
 *
 * Body: { "workspaceId"?: string (UUID), "domain": string, "classification": string, "title": string, "content": string }
 *
 * 201 response:
 * { "data": { "id": "...", ... } }
 *
 * Errors: 400 invalid_request, 401 unauthenticated, 403 forbidden — missing `draft_write` grant at this scope, 404 not_found
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const rawSql = neon(env.DATABASE_URL);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createKnowledgeItemBodySchema);

    const item = await createKnowledgeItem(db, rawSql, {
      organizationId,
      workspaceId: body.workspaceId ?? null,
      domain: body.domain,
      classification: body.classification,
      title: body.title,
      content: body.content,
      actorUserId: user.userId,
    });

    return jsonSuccess(item, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
