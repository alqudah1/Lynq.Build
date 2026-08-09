import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam, parseJsonBody } from "@/lib/http/validation";
import { listFounderApprovals, decideFounderApproval } from "@/lib/founder-os/approval-center";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/founder/approvals — pending Runtime approvals the current user is authorized to decide, with cross-module context. */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const approvals = await listFounderApprovals(db, { organizationId, actorUserId: user.userId });
    return jsonSuccess({ approvals });
  } catch (err) {
    return handleRouteError(err);
  }
}

const decideBodySchema = z
  .object({
    approvalId: z.string().uuid(),
    decision: z.enum(["approve", "reject", "request_revision"]),
    decisionNote: z.string().trim().max(2000).nullable().optional(),
    severe: z.boolean().optional(),
  })
  .strict();

/** POST /api/organizations/{organizationId}/founder/approvals — decide a real Runtime approval (approve/reject/request_revision), never a second approval system. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, decideBodySchema);
    const result = await decideFounderApproval(db, { organizationId, actorUserId: user.userId, ...body });
    return jsonSuccess(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
