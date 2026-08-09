import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { approveRequest, rejectRequest } from "@/lib/agent-runtime/approvals";
import { applyContentApprovalDecision } from "@/lib/marketing-os/content";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; contentId: string }> };

const decisionBodySchema = z
  .object({
    approvalRequestId: z.string().uuid(),
    decision: z.enum(["approved", "rejected"]),
    decisionNote: z.string().trim().max(1000).optional(),
    expectedRevision: z.number().int().min(1),
  })
  .strict();

/**
 * POST /api/organizations/{organizationId}/marketing/content/{contentId}/approval-decision
 * Decides the real Runtime approval request (`approveRequest`/`rejectRequest`
 * — the same generic decision surface every other approval in this codebase
 * uses, single-use, human-only) and then applies the corresponding content
 * status transition in one call. An agent has no callable path to either
 * step — "an agent cannot approve its own output" holds structurally.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, contentId: rawContent } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const contentItemId = parseUuidParam(rawContent);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, decisionBodySchema);

    if (body.decision === "approved") {
      await approveRequest(db, { organizationId, approvalId: body.approvalRequestId, decisionNote: body.decisionNote ?? null, actorUserId: user.userId });
    } else {
      await rejectRequest(db, { organizationId, approvalId: body.approvalRequestId, decisionNote: body.decisionNote ?? null, actorUserId: user.userId });
    }

    const item = await applyContentApprovalDecision(db, { organizationId, contentItemId, approvalRequestId: body.approvalRequestId, decision: body.decision, expectedRevision: body.expectedRevision, actorUserId: user.userId });
    return jsonSuccess(item);
  } catch (err) {
    return handleRouteError(err);
  }
}
