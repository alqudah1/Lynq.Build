import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { approveRequest, rejectRequest, requestRevision } from "@/lib/agent-runtime/approvals";
import { enqueueJob } from "@/lib/runtime/queue";
import { notifyApprovalDecided } from "@/lib/workflows/scheduling";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    decision: z.enum(["approved", "rejected", "revision_requested"]),
    decisionNote: z.string().trim().max(1000).optional(),
    severe: z.boolean().optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; executionId: string; approvalId: string }> };

/** POST .../approvals/{approvalId}/decide — §7's full decision surface. Single-use: an already-decided request cannot be decided again (409). */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, approvalId: rawApprovalId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const approvalId = parseUuidParam(rawApprovalId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);

    const result =
      body.decision === "approved"
        ? await approveRequest(db, { organizationId, approvalId, decisionNote: body.decisionNote ?? null, actorUserId: user.userId })
        : body.decision === "rejected"
          ? await rejectRequest(db, { organizationId, approvalId, decisionNote: body.decisionNote ?? null, severe: body.severe, actorUserId: user.userId })
          : await requestRevision(db, { organizationId, approvalId, decisionNote: body.decisionNote ?? null, actorUserId: user.userId });

    await notifyApprovalDecided(db, { organizationId, approvalRequestId: approvalId });
    if (body.decision !== "rejected" || !body.severe) {
      await enqueueJob(db, {
        organizationId,
        jobType: "execution_resume",
        executionId: result.executionId,
        idempotencyKey: `approval-resume:${result.id}`,
        priority: 100,
      });
    }

    return jsonSuccess(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
