"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users } from "@/db/schema";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { nameSchema, slugSchema, workspaceRoleSchema } from "@/lib/http/validation";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { createWorkspace, updateWorkspace, softDeleteWorkspace, getWorkspaceForAdministration } from "@/lib/workspaces/workspaces";
import { addWorkspaceMember, changeWorkspaceRole, removeWorkspaceMember } from "@/lib/workspaces/memberships";
import { ParentMembershipRequiredViolationError } from "@/lib/authz/errors";
import { toActionResult } from "./errors";
import { RESERVED_WORKSPACE_SLUGS } from "./reserved-slugs";
import type { ActionResult } from "./types";

const notReservedSlug = (slug: string) => !RESERVED_WORKSPACE_SLUGS.has(slug);
const reservedSlugMessage = { message: "This slug is reserved and can't be used." };

const createWorkspaceSchema = z.object({
  name: nameSchema,
  slug: slugSchema.refine(notReservedSlug, reservedSlugMessage),
});
const updateWorkspaceSchema = z
  .object({ name: nameSchema.optional(), slug: slugSchema.refine(notReservedSlug, reservedSlugMessage).optional() })
  .refine((data) => Object.keys(data).length > 0, { message: "At least one field must change." });
// Identifies the candidate by email, not internal user ID — the "add
// member" <select> never sends a raw UUID to or from the client (see
// AddWorkspaceMemberForm); the ID is resolved server-side from the email
// immediately below, exactly like OAuth account-linking already does.
const addMemberSchema = z.object({ email: z.string().email(), role: workspaceRoleSchema });
const changeRoleSchema = z.object({ role: workspaceRoleSchema });

/**
 * Creates a workspace. `createWorkspace` (Step 4A, unmodified) already
 * enforces organization owner/admin only, and — the existing, already-
 * approved domain behavior this step builds on rather than reinvents —
 * atomically grants the creator an explicit `manager` workspace
 * membership in the same transaction. No other organization member gains
 * workspace content access merely because a workspace was created; only
 * the creator does, exactly as `createWorkspace`'s own design comment
 * already documents ("without this, a brand-new workspace would have zero
 * members and be unreachable... even to the org admin who just created
 * it"). This action does not alter or add to that behavior.
 */
export async function createWorkspaceAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const env = loadEnv();
  const db = createDbClient(env);
  const rawSql = neon(env.DATABASE_URL);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/workspaces/new`);

  const parsed = createWorkspaceSchema.safeParse({ name: formData.get("name"), slug: formData.get("slug") });
  if (!parsed.success) {
    return toActionResult(parsed.error);
  }

  let workspaceSlug: string;
  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    const result = await createWorkspace(db, rawSql, {
      organizationId: organization.id,
      actorUserId: user.userId,
      name: parsed.data.name,
      slug: parsed.data.slug,
    });
    workspaceSlug = result.workspace.slug;
  } catch (err) {
    return toActionResult(err);
  }

  redirect(`/app/${organizationSlug}/${workspaceSlug}`);
}

/** Updates name/slug. Resolved via `getWorkspaceForAdministration` (manager OR org-admin-override) so an org owner/admin can reach this without an explicit workspace membership; `updateWorkspace` itself is the actual authorization gate. */
export async function updateWorkspaceAction(organizationSlug: string, workspaceSlug: string, formData: FormData): Promise<ActionResult> {
  const env = loadEnv();
  const db = createDbClient(env);
  const rawSql = neon(env.DATABASE_URL);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/${workspaceSlug}/settings`);

  const parsed = updateWorkspaceSchema.safeParse({
    name: formData.get("name") || undefined,
    slug: formData.get("slug") || undefined,
  });
  if (!parsed.success) {
    return toActionResult(parsed.error);
  }

  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    const { workspace } = await getWorkspaceForAdministration(db, organization.id, workspaceSlug, user.userId);
    await updateWorkspace(db, rawSql, {
      workspaceId: workspace.id,
      organizationId: organization.id,
      actorUserId: user.userId,
      updates: parsed.data,
    });
  } catch (err) {
    return toActionResult(err);
  }

  const nextSlug = parsed.data.slug ?? workspaceSlug;
  if (nextSlug !== workspaceSlug) {
    redirect(`/app/${organizationSlug}/${nextSlug}/settings`);
  }
  revalidatePath(`/app/${organizationSlug}/${workspaceSlug}/settings`);
  return { ok: true };
}

/** Soft-deletes the workspace. `softDeleteWorkspace` itself enforces org-owner/admin-only (never a workspace manager) — a manager attempting this gets the same `WorkspaceDeletionNotPermittedError` (409) it always has. */
export async function deleteWorkspaceAction(organizationSlug: string, workspaceSlug: string): Promise<ActionResult> {
  const env = loadEnv();
  const db = createDbClient(env);
  const rawSql = neon(env.DATABASE_URL);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/${workspaceSlug}/settings`);

  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    const { workspace } = await getWorkspaceForAdministration(db, organization.id, workspaceSlug, user.userId);
    await softDeleteWorkspace(db, rawSql, { workspaceId: workspace.id, organizationId: organization.id, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  redirect(`/app/${organizationSlug}`);
}

/**
 * Adds an existing organization member to the workspace, identified by
 * email rather than internal user ID (the client never sees or submits a
 * raw UUID for this — see `AddWorkspaceMemberForm`). The email is resolved
 * to a user ID here, the same case-insensitive lookup account-linking
 * already uses; a non-matching email is treated identically to "not a
 * parent-org member" (`ParentMembershipRequiredViolationError`), since
 * either way there is no eligible target. `addWorkspaceMember` itself
 * still independently enforces every real rule — never re-checked or
 * weakened here.
 */
export async function addWorkspaceMemberAction(organizationSlug: string, workspaceSlug: string, formData: FormData): Promise<ActionResult> {
  const env = loadEnv();
  const db = createDbClient(env);
  const rawSql = neon(env.DATABASE_URL);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/${workspaceSlug}/members`);

  const parsed = addMemberSchema.safeParse({ email: formData.get("email"), role: formData.get("role") });
  if (!parsed.success) {
    return toActionResult(parsed.error);
  }

  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    const { workspace } = await getWorkspaceForAdministration(db, organization.id, workspaceSlug, user.userId);

    const normalizedEmail = parsed.data.email.toLowerCase();
    const [matchedUser] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${normalizedEmail}`);
    if (!matchedUser) {
      throw new ParentMembershipRequiredViolationError();
    }

    await addWorkspaceMember(db, rawSql, {
      workspaceId: workspace.id,
      organizationId: organization.id,
      actorUserId: user.userId,
      targetUserId: matchedUser.id,
      role: parsed.data.role,
    });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/${workspaceSlug}/members`);
  return { ok: true };
}

/** Changes a workspace member's role. `changeWorkspaceRole` itself enforces every rule (self-change, never-downgrade is an acceptance-time rule elsewhere; here it's a direct role set) — never re-implemented here. */
export async function changeWorkspaceRoleAction(
  organizationSlug: string,
  workspaceSlug: string,
  targetUserId: string,
  formData: FormData
): Promise<ActionResult> {
  const env = loadEnv();
  const db = createDbClient(env);
  const rawSql = neon(env.DATABASE_URL);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/${workspaceSlug}/members`);

  const parsed = changeRoleSchema.safeParse({ role: formData.get("role") });
  if (!parsed.success) {
    return toActionResult(parsed.error);
  }

  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    const { workspace } = await getWorkspaceForAdministration(db, organization.id, workspaceSlug, user.userId);
    await changeWorkspaceRole(db, rawSql, {
      workspaceId: workspace.id,
      organizationId: organization.id,
      actorUserId: user.userId,
      targetUserId,
      newRole: parsed.data.role,
    });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/${workspaceSlug}/members`);
  return { ok: true };
}

/** Removes workspace access. `removeWorkspaceMember` itself is the authorization gate (manager or org-admin-override). */
export async function removeWorkspaceMemberAction(organizationSlug: string, workspaceSlug: string, targetUserId: string): Promise<ActionResult> {
  const env = loadEnv();
  const db = createDbClient(env);
  const rawSql = neon(env.DATABASE_URL);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/${workspaceSlug}/members`);

  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    const { workspace } = await getWorkspaceForAdministration(db, organization.id, workspaceSlug, user.userId);
    await removeWorkspaceMember(db, rawSql, {
      workspaceId: workspace.id,
      organizationId: organization.id,
      actorUserId: user.userId,
      targetUserId,
    });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/${workspaceSlug}/members`);
  return { ok: true };
}
