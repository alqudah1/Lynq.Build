import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam, parseJsonBody } from "@/lib/http/validation";
import { createFounderDecision, listFounderDecisions } from "@/lib/founder-os/decisions";
import { FOUNDER_DECISION_STATUSES, titleSchema, decisionTextSchema } from "@/lib/founder-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const decisions = await listFounderDecisions(db, { organizationId, actorUserId: user.userId });
    return jsonSuccess({ decisions });
  } catch (err) {
    return handleRouteError(err);
  }
}

const createBodySchema = z
  .object({
    workspaceId: z.string().uuid().nullable().optional(),
    title: titleSchema,
    decision: decisionTextSchema,
    contextSummary: z.string().trim().max(4000).nullable().optional(),
    decisionOwnerUserId: z.string().uuid(),
    decisionDate: z.coerce.date().optional(),
    relatedProjectId: z.string().uuid().nullable().optional(),
    relatedOpportunityId: z.string().uuid().nullable().optional(),
    relatedCampaignId: z.string().uuid().nullable().optional(),
    relatedWorkflowDefinitionId: z.string().uuid().nullable().optional(),
    relatedArtifactId: z.string().uuid().nullable().optional(),
    status: z.enum(FOUNDER_DECISION_STATUSES).optional(),
    reviewDate: z.coerce.date().nullable().optional(),
  })
  .strict();

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createBodySchema);
    const decision = await createFounderDecision(db, { organizationId, actorUserId: user.userId, ...body });
    return jsonSuccess(decision, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
