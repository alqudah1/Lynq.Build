"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { nameSchema, slugSchema, organizationRoleSchema } from "@/lib/http/validation";
import { createOrganization, updateOrganization, softDeleteOrganization, getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { changeOrganizationRole, removeOrganizationMember } from "@/lib/organizations/memberships";
import { toActionResult } from "./errors";
import { RESERVED_ORGANIZATION_SLUGS } from "./reserved-slugs";
import type { ActionResult } from "./types";

const notReservedSlug = (slug: string) => !RESERVED_ORGANIZATION_SLUGS.has(slug);
const reservedSlugMessage = { message: "This slug is reserved and can't be used." };

const createOrganizationSchema = z.object({
  name: nameSchema,
  slug: slugSchema.refine(notReservedSlug, reservedSlugMessage),
});
const updateOrganizationSchema = z
  .object({ name: nameSchema.optional(), slug: slugSchema.refine(notReservedSlug, reservedSlugMessage).optional() })
  .refine((data) => Object.keys(data).length > 0, { message: "At least one field must change." });
const changeRoleSchema = z.object({ role: organizationRoleSchema });

/**
 * Creates a new organization with the authenticated user as its first
 * owner (Step 4A's `createOrganization`, unmodified). No fake/default
 * organization is ever created automatically elsewhere — this form is the
 * only way one comes into existence. Redirects straight to the new
 * organization's dashboard on success; a duplicate slug now surfaces as a
 * clean `slug_taken` domain error (see `SlugAlreadyTakenError`) instead of
 * a raw database error.
 */
export async function createOrganizationAction(formData: FormData): Promise<ActionResult> {
  const env = loadEnv();
  const db = createDbClient(env);
  const rawSql = neon(env.DATABASE_URL);
  const user = await requireDashboardUser(db, "/app/new");

  const parsed = createOrganizationSchema.safeParse({ name: formData.get("name"), slug: formData.get("slug") });
  if (!parsed.success) {
    return toActionResult(parsed.error);
  }

  let result;
  try {
    result = await createOrganization(rawSql, { name: parsed.data.name, slug: parsed.data.slug, ownerUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  redirect(`/app/${result.organization.slug}`);
}

/** Updates name/slug. Authorization (owner/admin only) is enforced entirely by `updateOrganization` itself — this action only resolves the slug to an ID server-side, never trusts one from the client. */
export async function updateOrganizationAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const env = loadEnv();
  const db = createDbClient(env);
  const rawSql = neon(env.DATABASE_URL);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/settings`);

  const parsed = updateOrganizationSchema.safeParse({
    name: formData.get("name") || undefined,
    slug: formData.get("slug") || undefined,
  });
  if (!parsed.success) {
    return toActionResult(parsed.error);
  }

  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    await updateOrganization(db, rawSql, { organizationId: organization.id, actorUserId: user.userId, updates: parsed.data });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/settings`);
  // The slug itself may have just changed — the settings page must be re-fetched at its new address.
  const nextSlug = parsed.data.slug ?? organizationSlug;
  if (nextSlug !== organizationSlug) {
    redirect(`/app/${nextSlug}/settings`);
  }
  return { ok: true };
}

/** Soft-deletes the organization. `softDeleteOrganization` itself enforces owner-only — an admin attempting this gets the same `InsufficientRoleError` (403) it always has; nothing here weakens that. */
export async function deleteOrganizationAction(organizationSlug: string): Promise<ActionResult> {
  const env = loadEnv();
  const db = createDbClient(env);
  const rawSql = neon(env.DATABASE_URL);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/settings`);

  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    await softDeleteOrganization(db, rawSql, { organizationId: organization.id, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  redirect("/app");
}

/** Changes an organization member's role. `changeOrganizationRole` itself enforces every rule (self-change, admin-cannot-act-on-owner, last-owner) — never re-implemented or weakened here. */
export async function changeOrganizationRoleAction(organizationSlug: string, targetUserId: string, formData: FormData): Promise<ActionResult> {
  const env = loadEnv();
  const db = createDbClient(env);
  const rawSql = neon(env.DATABASE_URL);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/members`);

  const parsed = changeRoleSchema.safeParse({ role: formData.get("role") });
  if (!parsed.success) {
    return toActionResult(parsed.error);
  }

  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    await changeOrganizationRole(db, rawSql, {
      organizationId: organization.id,
      actorUserId: user.userId,
      targetUserId,
      newRole: parsed.data.role,
    });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/members`);
  return { ok: true };
}

/** Removes an organization member. `removeOrganizationMember` itself enforces every rule (admin-cannot-remove-owner, last-owner) — never re-implemented or weakened here. */
export async function removeOrganizationMemberAction(organizationSlug: string, targetUserId: string): Promise<ActionResult> {
  const env = loadEnv();
  const db = createDbClient(env);
  const rawSql = neon(env.DATABASE_URL);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/members`);

  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    await removeOrganizationMember(db, rawSql, { organizationId: organization.id, actorUserId: user.userId, targetUserId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/members`);
  return { ok: true };
}
