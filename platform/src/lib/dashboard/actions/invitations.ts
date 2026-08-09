"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { emailSchema, organizationRoleSchema, workspaceRoleSchema } from "@/lib/http/validation";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { createOrRefreshInvitation, revokeInvitation } from "@/lib/invitations/invitations";
import { notifyInvitationCreated } from "@/lib/email/invitation-notifier";
import { PostgresRateLimiter } from "@/lib/rate-limit/postgres";
import { enforceRateLimit, invitationCreateRateLimitKey, INVITATION_CREATE_RATE_LIMIT } from "@/lib/invitations/rate-limits";
import { toActionResult } from "./errors";
import type { ActionResult } from "./types";

const createInvitationSchema = z
  .object({
    email: emailSchema,
    role: organizationRoleSchema,
    workspaceId: z.string().uuid().optional(),
    workspaceRole: workspaceRoleSchema.optional(),
  })
  .refine((data) => !data.workspaceId === !data.workspaceRole, {
    message: "Choose a workspace role, or leave the workspace unset.",
    path: ["workspaceRole"],
  });

/** Success carries whether this call created a new invitation or refreshed an existing pending one — the UI's only way to tell the two apart, since `createOrRefreshInvitation` never distinguishes them in any other client-visible way. */
export type CreateInvitationActionResult = { ok: true; refreshed: boolean } | Extract<ActionResult, { ok: false }>;

/**
 * Creates a new pending invitation, or atomically refreshes an existing
 * pending one for the same email — `createOrRefreshInvitation` (Step 4C,
 * unmodified) decides which; this action never re-implements that choice.
 * Also used by the pending-invitation list's own "Resend" control (see
 * `InvitationRow`), which submits this same action with the row's
 * already-displayed email/role/workspace values as hidden fields — an
 * expired invitation resend naturally becomes a new row (the partial
 * unique index only applies to `status = 'pending'` rows), never a forced
 * update of dead history.
 *
 * Owner/admin only, and an admin may never invite someone as owner —
 * `createOrRefreshInvitation` itself enforces both; this action only
 * resolves the organization by slug and validates input shape. Email
 * delivery (`notifyInvitationCreated`) is best-effort and never affects
 * this action's own success — no transport is configured in this
 * environment (`RESEND_API_KEY` unset), so no real email is ever sent by
 * calling this.
 */
export async function createOrRefreshInvitationAction(organizationSlug: string, formData: FormData): Promise<CreateInvitationActionResult> {
  const env = loadEnv();
  const db = createDbClient(env);
  const rawSql = neon(env.DATABASE_URL);
  const limiter = new PostgresRateLimiter(db);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/invitations`);

  const parsed = createInvitationSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
    workspaceId: formData.get("workspaceId") || undefined,
    workspaceRole: formData.get("workspaceRole") || undefined,
  });
  if (!parsed.success) {
    return toActionResult(parsed.error) as CreateInvitationActionResult;
  }

  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    await enforceRateLimit(limiter, invitationCreateRateLimitKey(organization.id, user.userId), INVITATION_CREATE_RATE_LIMIT);

    const result = await createOrRefreshInvitation(db, rawSql, {
      organizationId: organization.id,
      actorUserId: user.userId,
      email: parsed.data.email,
      role: parsed.data.role,
      workspace: parsed.data.workspaceId && parsed.data.workspaceRole ? { workspaceId: parsed.data.workspaceId, workspaceRole: parsed.data.workspaceRole } : null,
    });

    await notifyInvitationCreated(db, result, user.userId);

    revalidatePath(`/app/${organizationSlug}/invitations`);
    return { ok: true, refreshed: result.refreshed };
  } catch (err) {
    return toActionResult(err) as CreateInvitationActionResult;
  }
}

/**
 * Revokes a pending invitation. `revokeInvitation` (Step 4C, unmodified)
 * enforces owner/admin-only and "must currently be pending" — never
 * re-implemented here. `invitationId` is only ever supplied by this
 * action's own caller having bound it server-side (the invitation
 * management page binds one instance of this action per row before
 * handing it to the client list) — never a prop a client component holds
 * or could substitute a different value into.
 */
export async function revokeInvitationAction(organizationSlug: string, invitationId: string): Promise<ActionResult> {
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/invitations`);

  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    await revokeInvitation(db, { organizationId: organization.id, actorUserId: user.userId, invitationId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/invitations`);
  return { ok: true };
}
