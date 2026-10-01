import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { linkToCrm } from "@/lib/social-os/engagement";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; itemId: string }> };

const bodySchema = z
  .object({ mode: z.enum(["create_lead", "existing_lead", "existing_contact"]), leadId: z.string().uuid().optional(), contactId: z.string().uuid().optional(), expectedRevision: z.number().int().min(1) })
  .strict()
  .refine((b) => b.mode !== "existing_lead" || b.leadId, { message: "leadId is required for existing_lead" })
  .refine((b) => b.mode !== "existing_contact" || b.contactId, { message: "contactId is required for existing_contact" });

/** POST /api/organizations/{organizationId}/social/inbox/{itemId}/crm-link — create a CRM lead or link an existing lead/contact. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, itemId: rawItemId } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const itemId = parseUuidParam(rawItemId);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);
    const item = await linkToCrm(db, { organizationId, engagementItemId: itemId, actorUserId: user.userId, ...body });
    return jsonSuccess(item);
  } catch (err) {
    return handleRouteError(err);
  }
}
