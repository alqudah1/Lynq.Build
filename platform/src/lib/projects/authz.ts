import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { projectMembers, workspaceMemberships } from "@/db/schema";
import { requireOrganizationMembership, type OrganizationRole, type WorkspaceRole } from "@/lib/authz/helpers";
import { InsufficientRoleError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import type { ProjectMemberRole } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Project authorization — Module 10
 * ============================================================================
 * Deliberately separate from Brain grants (a project role never implies
 * Brain access, and vice versa) and from the Agent Runtime's own
 * execution-scoped authz — this module answers exactly one question:
 * "what may this human do to this project's own records." Resolved once
 * per request into a small context object, then checked by cheap,
 * synchronous guard functions, rather than re-querying membership tables
 * for every individual check.
 */
export interface ProjectAuthContext {
  organizationId: string;
  actorUserId: string;
  orgRole: OrganizationRole;
  projectRole: ProjectMemberRole | null;
  workspaceRole: WorkspaceRole | null;
  isWorkspaceScoped: boolean;
}

function isOrgAdmin(ctx: Pick<ProjectAuthContext, "orgRole">): boolean {
  return ctx.orgRole === "owner" || ctx.orgRole === "admin";
}

function isWorkspaceManager(ctx: Pick<ProjectAuthContext, "isWorkspaceScoped" | "workspaceRole">): boolean {
  return ctx.isWorkspaceScoped && ctx.workspaceRole === "manager";
}

/** Resolves everything a project-authorization decision needs in one pass: organization membership (required — throws if absent), this project's own member role (if any), and workspace role (if this project is workspace-scoped). */
export async function resolveProjectAuthContext(
  db: Db,
  input: { organizationId: string; project: { id: string; workspaceId: string | null }; actorUserId: string }
): Promise<ProjectAuthContext> {
  const orgMembership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);

  const [memberRow] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, input.project.id), eq(projectMembers.userId, input.actorUserId)));

  let workspaceRole: WorkspaceRole | null = null;
  if (input.project.workspaceId) {
    const [wsRow] = await db
      .select({ role: workspaceMemberships.role })
      .from(workspaceMemberships)
      .where(and(eq(workspaceMemberships.workspaceId, input.project.workspaceId), eq(workspaceMemberships.userId, input.actorUserId)));
    workspaceRole = wsRow?.role ?? null;
  }

  return {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    orgRole: orgMembership.role,
    projectRole: memberRow?.role ?? null,
    workspaceRole,
    isWorkspaceScoped: Boolean(input.project.workspaceId),
  };
}

async function denyAndAudit(db: Db, ctx: ProjectAuthContext, projectId: string, detail: string): Promise<never> {
  await recordAuditEvent(db, {
    eventType: "project_permission_denied",
    actorUserId: ctx.actorUserId,
    organizationId: ctx.organizationId,
    targetType: "project",
    targetId: projectId,
    metadata: { detail },
  });
  throw new InsufficientRoleError(detail);
}

/** Org owner/admin OR workspace manager (for a workspace-scoped project) may create a new project. */
export function requireProjectCreateAuthority(input: { orgRole: OrganizationRole; workspaceId: string | null; workspaceRole: WorkspaceRole | null }): void {
  const admin = input.orgRole === "owner" || input.orgRole === "admin";
  const workspaceManager = Boolean(input.workspaceId) && input.workspaceRole === "manager";
  if (admin || workspaceManager) return;
  throw new InsufficientRoleError("requires organization owner/admin, or workspace manager for a workspace-scoped project");
}

/** Read visibility: org owner/admin, any project member (including viewer), or any workspace member for a workspace-scoped project. */
export async function requireProjectViewAuthority(db: Db, ctx: ProjectAuthContext, projectId: string): Promise<void> {
  if (isOrgAdmin(ctx) || ctx.projectRole !== null || (ctx.isWorkspaceScoped && ctx.workspaceRole !== null)) return;
  await denyAndAudit(db, ctx, projectId, "requires project visibility");
}

/** Settings/archive/member-management floor: org owner/admin, workspace manager, or this project's own `project_owner`. */
export async function requireProjectManageAuthority(db: Db, ctx: ProjectAuthContext, projectId: string): Promise<void> {
  if (isOrgAdmin(ctx) || isWorkspaceManager(ctx) || ctx.projectRole === "project_owner") return;
  await denyAndAudit(db, ctx, projectId, "requires project owner, workspace manager, or organization owner/admin");
}

/** Phases/milestones/tasks/assignments/dependencies management floor — one step below full project management. */
export async function requireProjectContentAuthority(db: Db, ctx: ProjectAuthContext, projectId: string): Promise<void> {
  if (isOrgAdmin(ctx) || isWorkspaceManager(ctx) || ctx.projectRole === "project_owner" || ctx.projectRole === "project_manager") return;
  await denyAndAudit(db, ctx, projectId, "requires project manager, project owner, workspace manager, or organization owner/admin");
}

/** Contributors may create tasks and update ones assigned to them; everyone at the content-authority floor may update any task. */
export async function requireTaskUpdateAuthority(db: Db, ctx: ProjectAuthContext, projectId: string, isAssignee: boolean): Promise<void> {
  if (isOrgAdmin(ctx) || isWorkspaceManager(ctx) || ctx.projectRole === "project_owner" || ctx.projectRole === "project_manager") return;
  if (ctx.projectRole === "contributor" && isAssignee) return;
  await denyAndAudit(db, ctx, projectId, "requires management authority, or being an assigned contributor");
}

export async function requireTaskCreateAuthority(db: Db, ctx: ProjectAuthContext, projectId: string): Promise<void> {
  if (isOrgAdmin(ctx) || isWorkspaceManager(ctx) || ctx.projectRole === "project_owner" || ctx.projectRole === "project_manager" || ctx.projectRole === "contributor") return;
  await denyAndAudit(db, ctx, projectId, "requires at least contributor");
}

/** Launching an agent execution — project_owner and above may always launch; project_manager may launch "approved" (i.e. pre-registered, already-vetted) agents — in this phase, the Knowledge Analyst is the only agent this applies to. */
export async function requireLaunchAgentExecutionAuthority(db: Db, ctx: ProjectAuthContext, projectId: string): Promise<void> {
  if (isOrgAdmin(ctx) || isWorkspaceManager(ctx) || ctx.projectRole === "project_owner" || ctx.projectRole === "project_manager") return;
  await denyAndAudit(db, ctx, projectId, "requires project manager, project owner, workspace manager, or organization owner/admin");
}
