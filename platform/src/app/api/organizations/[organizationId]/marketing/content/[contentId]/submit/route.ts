import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { submitContentForReview } from "@/lib/marketing-os/content";
import { requestContentReviewApproval } from "@/lib/marketing-os/agents";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; contentId: string }> };

const submitBodySchema = z.object({ expectedRevision: z.number().int().min(1), summary: z.string().trim().min(1).max(2000) }).strict();

/** POST /api/organizations/{organizationId}/marketing/content/{contentId}/submit — transitions the content item to "review" and creates the real Runtime approval request in one call. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, contentId: rawContent } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const contentItemId = parseUuidParam(rawContent);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, submitBodySchema);
    const item = await submitContentForReview(db, { organizationId, contentItemId, toStatus: "review", expectedRevision: body.expectedRevision, actorUserId: user.userId });
    const { approval } = await requestContentReviewApproval(db, { organizationId, contentItemId, summary: body.summary, actorUserId: user.userId });
    return jsonSuccess({ item, approval }, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
