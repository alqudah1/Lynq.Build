import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingTeams, marketingTeamMembers } from "@/db/schema";
import { requireOrganizationMembership, requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { resolveMarketingAuthContext, requireMarketingAdminAuthority, requireMarketingViewAuthority } from "./authz";
import { MarketingKeyAlreadyTakenError } from "./errors";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import type { MarketingTeamMemberRole } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface MarketingTeam {
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

export interface MarketingTeamMember {
  id: string;
  organizationId: string;
  teamId: string;
  userId: string;
  teamRole: MarketingTeamMemberRole;
  isActive: boolean;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Operational grouping only — team creation never grants any Marketing OS capability by itself. */
export async function createMarketingTeam(db: Db, input: { organizationId: string; workspaceId?: string | null; name: string; teamKey: string; description?: string; actorUserId: string }): Promise<MarketingTeam> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingAdminAuthority(db, ctx, "marketing_team", "new");

  let row: MarketingTeam;
  try {
    [row] = await db
      .insert(marketingTeams)
      .values({ organizationId: input.organizationId, workspaceId: input.workspaceId ?? null, name: input.name, teamKey: input.teamKey, description: input.description ?? null })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new MarketingKeyAlreadyTakenError("marketing team", input.teamKey);
    throw err;
  }

  await recordAuditEvent(db, { eventType: "marketing_team_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_team", targetId: row.id, metadata: { teamKey: row.teamKey } });
  return row;
}

export async function resolveMarketingTeamById(db: Db, organizationId: string, teamId: string): Promise<MarketingTeam> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(marketingTeams).where(and(eq(marketingTeams.id, teamId), eq(marketingTeams.organizationId, organizationId)));
    return row;
  });
}

export async function listMarketingTeams(db: Db, input: { organizationId: string; actorUserId: string }): Promise<MarketingTeam[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_team", "list");
  return db.select().from(marketingTeams).where(eq(marketingTeams.organizationId, input.organizationId)).orderBy(marketingTeams.name);
}

export interface AddMarketingTeamMemberInput {
  organizationId: string;
  teamId: string;
  userId: string;
  teamRole?: MarketingTeamMemberRole;
  actorUserId: string;
}

/** The target user must already be an eligible organization member — Marketing OS never creates a new user identity or grants org membership. */
export async function addMarketingTeamMember(db: Db, input: AddMarketingTeamMemberInput): Promise<MarketingTeamMember> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingAdminAuthority(db, ctx, "marketing_team", input.teamId);

  const team = await resolveMarketingTeamById(db, input.organizationId, input.teamId);
  await requireOrganizationMembership(db, input.organizationId, input.userId);

  const [row] = await db
    .insert(marketingTeamMembers)
    .values({ organizationId: input.organizationId, teamId: team.id, userId: input.userId, teamRole: input.teamRole ?? "contributor" })
    .returning();

  await recordAuditEvent(db, { eventType: "marketing_team_member_added", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_team_member", targetId: row.id, metadata: { teamId: team.id, teamRole: row.teamRole } });
  return row;
}

export async function listMarketingTeamMembers(db: Db, input: { organizationId: string; teamId: string; actorUserId: string }): Promise<MarketingTeamMember[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_team", input.teamId);
  return db.select().from(marketingTeamMembers).where(and(eq(marketingTeamMembers.organizationId, input.organizationId), eq(marketingTeamMembers.teamId, input.teamId)));
}
