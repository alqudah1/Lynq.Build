import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { organizations, organizationMemberships } from "@/db/schema";
import {
  requireOrganizationMembership,
  requireOrganizationRole,
  requireTenantScopedResource,
  type OrganizationMembershipRecord,
  type OrganizationRole,
} from "@/lib/authz/helpers";
import { auditInsertQuery } from "@/lib/audit";
import { SlugAlreadyTakenError } from "@/lib/authz/errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type RawSql = NeonQueryFunction<false, false>;

const POSTGRES_UNIQUE_VIOLATION = "23505";
function isPostgresUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === POSTGRES_UNIQUE_VIOLATION;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  ownerUserId: string;
}

export interface CreateOrganizationResult {
  organization: Organization;
  ownerMembership: OrganizationMembershipRecord;
}

/**
 * Creates an organization and its first owner membership atomically — one
 * never exists without the other — with the `organization_created` audit
 * event in the same transaction (Step 4A: "creating an organization and
 * its first owner membership" is an explicitly required transaction
 * boundary; the audit-atomicity principle established in Step 3 applies
 * identically here — a failed audit write rolls back the whole thing
 * rather than leaving an unlogged organization).
 */
export async function createOrganization(rawSql: RawSql, input: CreateOrganizationInput): Promise<CreateOrganizationResult> {
  const organizationId = randomUUID();
  const membershipId = randomUUID();
  const now = new Date();

  try {
    await rawSql.transaction([
      rawSql`INSERT INTO organizations (id, name, slug, created_at, updated_at)
             VALUES (${organizationId}, ${input.name}, ${input.slug}, ${now}, ${now})`,
      rawSql`INSERT INTO organization_memberships (id, organization_id, user_id, role, created_at, updated_at)
             VALUES (${membershipId}, ${organizationId}, ${input.ownerUserId}, 'owner', ${now}, ${now})`,
      auditInsertQuery(rawSql, {
        eventType: "organization_created",
        actorUserId: input.ownerUserId,
        organizationId,
        targetType: "organization",
        targetId: organizationId,
      }),
    ]);
  } catch (err) {
    if (isPostgresUniqueViolation(err)) {
      throw new SlugAlreadyTakenError(input.slug);
    }
    throw err;
  }

  return {
    organization: { id: organizationId, name: input.name, slug: input.slug, deletedAt: null, createdAt: now, updatedAt: now },
    ownerMembership: { organizationId, userId: input.ownerUserId, role: "owner" },
  };
}

/**
 * The tenant-scoped read pattern (Step 4A §7): membership is verified
 * first, then the organization row is fetched with the same organization
 * ID and a `deleted_at IS NULL` filter already in its own WHERE clause —
 * never fetched globally by ID and checked afterward. A nonexistent,
 * soft-deleted, or inaccessible (non-member) organization all produce the
 * identical `TenantResourceNotFoundError`.
 */
export async function getOrganizationForUser(
  db: Db,
  organizationId: string,
  userId: string
): Promise<{ organization: Organization; membership: OrganizationMembershipRecord }> {
  const membership = await requireOrganizationMembership(db, organizationId, userId);

  const organization = await requireTenantScopedResource(async () => {
    const [row] = await db
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, organizationId), isNull(organizations.deletedAt)));
    return row;
  });

  return { organization, membership };
}

/**
 * Slug-keyed variant of `getOrganizationForUser` (Step 5A: dashboard routes
 * use `/app/{organizationSlug}`, never a raw ID, per "do not expose
 * database IDs in primary user-facing URLs where slugs are available").
 * Order is necessarily reversed from the ID-based lookup — the
 * organization must be resolved by slug FIRST (there is no ID to check
 * membership against yet) — but produces the identical
 * `TenantResourceNotFoundError` whether the slug matches no non-deleted
 * organization at all, or matches one this user isn't a member of; a
 * cross-tenant slug guess cannot distinguish the two.
 */
export async function getOrganizationBySlugForUser(
  db: Db,
  slug: string,
  userId: string
): Promise<{ organization: Organization; membership: OrganizationMembershipRecord }> {
  const organization = await requireTenantScopedResource(async () => {
    const [row] = await db
      .select()
      .from(organizations)
      .where(and(eq(organizations.slug, slug), isNull(organizations.deletedAt)));
    return row;
  });

  const membership = await requireOrganizationMembership(db, organization.id, userId);

  return { organization, membership };
}

export interface UpdateOrganizationInput {
  organizationId: string;
  actorUserId: string;
  updates: { name?: string; slug?: string };
}

/** Only owners and admins may update organization details (Step 4A organization rules). */
export async function updateOrganization(db: Db, rawSql: RawSql, input: UpdateOrganizationInput): Promise<Organization> {
  const membership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);
  requireOrganizationRole(membership, ["owner", "admin"]);

  const now = new Date();
  try {
    await rawSql.transaction([
      rawSql`UPDATE organizations
             SET name = COALESCE(${input.updates.name ?? null}, name),
                 slug = COALESCE(${input.updates.slug ?? null}, slug),
                 updated_at = ${now}
             WHERE id = ${input.organizationId} AND deleted_at IS NULL`,
      auditInsertQuery(rawSql, {
        eventType: "organization_updated",
        actorUserId: input.actorUserId,
        organizationId: input.organizationId,
        targetType: "organization",
        targetId: input.organizationId,
        metadata: { updatedFields: Object.keys(input.updates) },
      }),
    ]);
  } catch (err) {
    if (isPostgresUniqueViolation(err) && input.updates.slug) {
      throw new SlugAlreadyTakenError(input.updates.slug);
    }
    throw err;
  }

  return requireTenantScopedResource(async () => {
    const [row] = await db
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, input.organizationId), isNull(organizations.deletedAt)));
    return row;
  });
}

export interface SoftDeleteOrganizationInput {
  organizationId: string;
  actorUserId: string;
}

/**
 * Only owners may delete an organization (Step 4A organization rules).
 * Cascades the soft delete to the organization's workspaces in the same
 * transaction — a deleted organization's workspaces stop being
 * independently "active" rather than requiring every future workspace
 * query to additionally join against the parent organization's own
 * `deleted_at` to stay correct.
 */
export async function softDeleteOrganization(db: Db, rawSql: RawSql, input: SoftDeleteOrganizationInput): Promise<void> {
  const membership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);
  requireOrganizationRole(membership, ["owner"]);

  const now = new Date();
  await rawSql.transaction([
    rawSql`UPDATE organizations SET deleted_at = ${now} WHERE id = ${input.organizationId} AND deleted_at IS NULL`,
    rawSql`UPDATE workspaces SET deleted_at = ${now} WHERE organization_id = ${input.organizationId} AND deleted_at IS NULL`,
    auditInsertQuery(rawSql, {
      eventType: "organization_deleted",
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      targetType: "organization",
      targetId: input.organizationId,
    }),
  ]);
}

export interface OrganizationForUser extends Organization {
  role: OrganizationRole;
}

/** Every organization this user belongs to (an organization switcher's data source) — soft-deleted organizations excluded. */
export async function listOrganizationsForUser(db: Db, userId: string): Promise<OrganizationForUser[]> {
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      deletedAt: organizations.deletedAt,
      createdAt: organizations.createdAt,
      updatedAt: organizations.updatedAt,
      role: organizationMemberships.role,
    })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizationMemberships.organizationId, organizations.id))
    .where(and(eq(organizationMemberships.userId, userId), isNull(organizations.deletedAt)));

  return rows;
}
