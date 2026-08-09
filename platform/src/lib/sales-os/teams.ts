import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { salesTeams, salesTeamMembers } from "@/db/schema";
import { requireOrganizationMembership, requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { resolveSalesAuthContext, requireSalesAdminAuthority, requireSalesViewAuthority } from "./authz";
import { SalesKeyAlreadyTakenError, IneligibleAssigneeError } from "./errors";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import type { SalesTeamMemberRole } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface SalesTeam {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  name: string;
  teamKey: string;
  description: string | null;
  revision: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SalesTeamMember {
  id: string;
  organizationId: string;
  teamId: string;
  userId: string;
  teamRole: SalesTeamMemberRole;
  isActive: boolean;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSalesTeamInput {
  organizationId: string;
  workspaceId?: string | null;
  name: string;
  teamKey: string;
  description?: string;
  actorUserId: string;
}

/** Operational grouping only — team creation never grants any Sales OS capability by itself. */
export async function createSalesTeam(db: Db, input: CreateSalesTeamInput): Promise<SalesTeam> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesAdminAuthority(db, ctx, "sales_team", "new");

  let row: SalesTeam;
  try {
    [row] = await db
      .insert(salesTeams)
      .values({ organizationId: input.organizationId, workspaceId: input.workspaceId ?? null, name: input.name, teamKey: input.teamKey, description: input.description ?? null })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new SalesKeyAlreadyTakenError("sales team", input.teamKey);
    throw err;
  }

  await recordAuditEvent(db, { eventType: "sales_team_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "sales_team", targetId: row.id, metadata: { teamKey: row.teamKey } });
  return row;
}

export async function resolveSalesTeamById(db: Db, organizationId: string, teamId: string): Promise<SalesTeam> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(salesTeams).where(and(eq(salesTeams.id, teamId), eq(salesTeams.organizationId, organizationId)));
    return row;
  });
}

export async function listSalesTeams(db: Db, input: { organizationId: string; actorUserId: string }): Promise<SalesTeam[]> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesViewAuthority(db, ctx, "sales_team", "list");
  return db.select().from(salesTeams).where(eq(salesTeams.organizationId, input.organizationId)).orderBy(salesTeams.name);
}

export interface AddSalesTeamMemberInput {
  organizationId: string;
  teamId: string;
  userId: string;
  teamRole?: SalesTeamMemberRole;
  actorUserId: string;
}

/** The target user must already be an eligible organization member — Sales OS never creates a new user identity or grants org membership. */
export async function addSalesTeamMember(db: Db, input: AddSalesTeamMemberInput): Promise<SalesTeamMember> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesAdminAuthority(db, ctx, "sales_team", input.teamId);

  const team = await resolveSalesTeamById(db, input.organizationId, input.teamId);
  try {
    await requireOrganizationMembership(db, input.organizationId, input.userId);
  } catch {
    throw new IneligibleAssigneeError("not a member of this organization");
  }

  let row: SalesTeamMember;
  try {
    [row] = await db
      .insert(salesTeamMembers)
      .values({ organizationId: input.organizationId, teamId: team.id, userId: input.userId, teamRole: input.teamRole ?? "rep" })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new IneligibleAssigneeError("already a member of this team");
    throw err;
  }

  await recordAuditEvent(db, { eventType: "sales_team_member_added", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "sales_team_member", targetId: row.id, metadata: { teamId: team.id, teamRole: row.teamRole } });
  return row;
}

export async function removeSalesTeamMember(db: Db, input: { organizationId: string; teamMemberId: string; expectedRevision: number; actorUserId: string }): Promise<void> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesAdminAuthority(db, ctx, "sales_team_member", input.teamMemberId);

  const [deleted] = await db
    .delete(salesTeamMembers)
    .where(and(eq(salesTeamMembers.id, input.teamMemberId), eq(salesTeamMembers.organizationId, input.organizationId), eq(salesTeamMembers.revision, input.expectedRevision)))
    .returning();
  if (!deleted) throw new IneligibleAssigneeError("membership was already changed — reload and try again");

  await recordAuditEvent(db, { eventType: "sales_team_member_removed", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "sales_team_member", targetId: input.teamMemberId, metadata: { teamId: deleted.teamId } });
}

export async function listSalesTeamMembers(db: Db, input: { organizationId: string; teamId: string; actorUserId: string }): Promise<SalesTeamMember[]> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesViewAuthority(db, ctx, "sales_team", input.teamId);
  return db.select().from(salesTeamMembers).where(and(eq(salesTeamMembers.organizationId, input.organizationId), eq(salesTeamMembers.teamId, input.teamId)));
}

/** Every active member of every team the organization has — the pool `least_open_leads`/`round_robin` assignment draws from before further eligibility filtering. */
export async function listActiveSalesTeamMemberUserIds(db: Db, organizationId: string): Promise<string[]> {
  const rows = await db.select({ userId: salesTeamMembers.userId }).from(salesTeamMembers).where(and(eq(salesTeamMembers.organizationId, organizationId), eq(salesTeamMembers.isActive, true)));
  return [...new Set(rows.map((r) => r.userId))];
}

/**
 * Module 14 — real Sales team membership check for the lead qualification
 * authority path: true only if `managerUserId` holds `teamRole: "manager"`
 * on some active team that `repUserId` is ALSO an active member of. Never
 * org-wide: a manager who manages Team A has no authority over a rep on
 * Team B, and this returns `false` for a rep with no team at all (an
 * unassigned lead, or a lead owned by a rep on no team, requires an
 * explicit org-admin decision — see `requireSalesLeadQualificationAuthority`'s
 * own doc comment for why that boundary is deliberate, not an oversight).
 */
export async function isTeamManagerOfRep(db: Db, input: { organizationId: string; managerUserId: string; repUserId: string }): Promise<boolean> {
  const managerTeamIds = await db
    .select({ teamId: salesTeamMembers.teamId })
    .from(salesTeamMembers)
    .where(and(eq(salesTeamMembers.organizationId, input.organizationId), eq(salesTeamMembers.userId, input.managerUserId), eq(salesTeamMembers.teamRole, "manager"), eq(salesTeamMembers.isActive, true)));
  if (managerTeamIds.length === 0) return false;

  const teamIdSet = new Set(managerTeamIds.map((r) => r.teamId));
  const repTeamIds = await db
    .select({ teamId: salesTeamMembers.teamId })
    .from(salesTeamMembers)
    .where(and(eq(salesTeamMembers.organizationId, input.organizationId), eq(salesTeamMembers.userId, input.repUserId), eq(salesTeamMembers.isActive, true)));

  return repTeamIds.some((r) => teamIdSet.has(r.teamId));
}
