import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { neon } from "@neondatabase/serverless";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, uuidParam } from "@/lib/http/validation";
import { knowledgeDomainSchema, knowledgeClassificationSchema, knowledgeTitleSchema, knowledgeContentSchema, knowledgeItemStatusSchema, knowledgeListLimitSchema } from "@/lib/brain/validation";
import { authenticateAgentForRoute } from "@/lib/agents/route-helpers";
import { listKnowledgeItemsForAgent } from "@/lib/agents/brain-reads";
import { createDraftKnowledgeItemAsAgent } from "@/lib/agents/drafts";

export const dynamic = "force-dynamic";

const createDraftBodySchema = z
  .object({
    workspaceId: uuidParam.optional(),
    domain: knowledgeDomainSchema,
    classification: knowledgeClassificationSchema,
    title: knowledgeTitleSchema,
    content: knowledgeContentSchema,
  })
  .strict();

/**
 * GET /api/agent/brain/knowledge
 * Agent-authenticated (`Authorization: Bearer <agent credential>`, never a
 * human session). Lists knowledge items this agent holds an active `read`
 * Domain Grant for, at the exact matching scope — never every item in the
 * organization. Omitting `workspaceId` returns organization-scoped items
 * only (Agent Registry has no workspace-membership concept to expand
 * into, unlike the human list endpoint).
 *
 * Query params: workspaceId?, domain?, classification?, status? (default "draft"), cursor?, limit?
 *
 * Errors: 400 invalid_request, 401 unauthenticated (missing/invalid/revoked credential, or a retired agent), 429 rate_limited
 */
export async function GET(request: Request) {
  try {
    const env = loadEnv();
    const db = createDbClient(env);
    const principal = await authenticateAgentForRoute(db, request, "list");

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

    const result = await listKnowledgeItemsForAgent(db, principal, {
      workspaceId: query.workspaceId ?? null,
      domain: query.domain,
      classification: query.classification,
      status: query.status,
      cursor: query.cursor ?? null,
      limit: query.limit,
    });

    return jsonSuccess(result);
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/agent/brain/knowledge
 * Brain Module 17's one bounded write path — creates a Draft-status
 * knowledge item authored by this agent. Requires the `draft_write`
 * capability at this exact scope; never substitutable by the agent's
 * `permissionLevel` or `department`.
 *
 * Body: { workspaceId?, domain, classification, title, content }
 *
 * Errors: 400 invalid_request, 401 unauthenticated, 403 forbidden (missing draft_write), 429 rate_limited
 */
export async function POST(request: Request) {
  try {
    const env = loadEnv();
    const db = createDbClient(env);
    const rawSql = neon(env.DATABASE_URL);
    const principal = await authenticateAgentForRoute(db, request, "draft_create");

    const body = await parseJsonBody(request, createDraftBodySchema);

    const item = await createDraftKnowledgeItemAsAgent(db, rawSql, principal, {
      workspaceId: body.workspaceId ?? null,
      domain: body.domain,
      classification: body.classification,
      title: body.title,
      content: body.content,
    });

    return jsonSuccess(item, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
