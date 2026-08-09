import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { applyMessageApprovalDecision } from "@/lib/communications-os/messages";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; messageId: string }> };
const bodySchema = z.object({ decision: z.enum(["approved", "rejected"]), decisionNote: z.string().trim().max(2000).optional() }).strict();

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, messageId: rawMsg } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const messageId = parseUuidParam(rawMsg);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);
    const message = await applyMessageApprovalDecision(db, { organizationId, messageId, decision: body.decision, decisionNote: body.decisionNote, actorUserId: user.userId });
    return jsonSuccess(message);
  } catch (err) {
    return handleRouteError(err);
  }
}
