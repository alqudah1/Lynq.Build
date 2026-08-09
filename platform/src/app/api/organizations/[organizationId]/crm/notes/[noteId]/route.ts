import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { updateNote, archiveNote } from "@/lib/crm/notes";
import { crmBoundedTextSchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

const patchBodySchema = z
  .object({ expectedRevision: z.number().int().min(1), content: crmBoundedTextSchema.optional(), archive: z.boolean().optional() })
  .strict()
  .refine((body) => body.archive || body.content !== undefined, { message: "content is required unless archiving" });

type RouteParams = { params: Promise<{ organizationId: string; noteId: string }> };

/** PATCH /api/organizations/{organizationId}/crm/notes/{noteId} — `archive: true` archives instead of editing content. */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, noteId: rawNoteId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const noteId = parseUuidParam(rawNoteId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, patchBodySchema);

    if (body.archive) {
      const archived = await archiveNote(db, { organizationId, noteId, expectedRevision: body.expectedRevision, actorUserId: user.userId });
      return jsonSuccess(archived);
    }

    const updated = await updateNote(db, { organizationId, noteId, expectedRevision: body.expectedRevision, content: body.content!, actorUserId: user.userId });
    return jsonSuccess(updated);
  } catch (err) {
    return handleRouteError(err);
  }
}
