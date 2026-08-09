import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { workspaceMemberships, projectMembers } from "@/db/schema";
import { requireOrganizationMembership, type OrganizationRole, type WorkspaceRole } from "@/lib/authz/helpers";
import { InsufficientRoleError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import type { ProjectMemberRole } from "@/lib/projects/validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Workflow Engine authorization — Module 11
 * ============================================================================
 * Deliberately separate from Brain grants, Agent Runtime authorization, and
 * Projects Core authorization — a workflow role never implies any of those.
 * Unlike Projects Core, there is no per-workflow membership table: authority
 * over a workflow DEFINITION resolves from organization role plus (for a
 * workspace-scoped definition) workspace role only. Authority over an
 * EXECUTION additionally considers the linked project's own membership,
 * when the execution is project-linked — "project owner/manager may start
 * an approved workflow linked to their project."
 */
export interface WorkflowAuthContext {
  organizationId: string;
  actorUserId: string;
  orgRole: OrganizationRole;
  workspaceRole: WorkspaceRole | null;
  isWorkspaceScoped: boolean;
}

function isOrgAdmin(ctx: Pick<WorkflowAuthContext, "orgRole">): boolean {
  return ctx.orgRole === "owner" || ctx.orgRole === "admin";
}

function isWorkspaceManager(ctx: Pick<WorkflowAuthContext, "isWorkspaceScoped" | "workspaceRole">): boolean {
  return ctx.isWorkspaceScoped && ctx.workspaceRole === "manager";
}

export async function resolveWorkflowAuthContext(db: Db, input: { organizationId: string; workspaceId: string | null; actorUserId: string }): Promise<WorkflowAuthContext> {
  const orgMembership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);

  let workspaceRole: WorkspaceRole | null = null;
  if (input.workspaceId) {
    const [wsRow] = await db.select({ role: workspaceMemberships.role }).from(workspaceMemberships).where(and(eq(workspaceMemberships.workspaceId, input.workspaceId), eq(workspaceMemberships.userId, input.actorUserId)));
    workspaceRole = wsRow?.role ?? null;
  }

  return { organizationId: input.organizationId, actorUserId: input.actorUserId, orgRole: orgMembership.role, workspaceRole, isWorkspaceScoped: Boolean(input.workspaceId) };
}

async function resolveProjectRole(db: Db, projectId: string | null, actorUserId: string): Promise<ProjectMemberRole | null> {
  if (!projectId) return null;
  const [row] = await db.select({ role: projectMembers.role }).from(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, actorUserId)));
  return row?.role ?? null;
}

async function denyAndAudit(db: Db, ctx: WorkflowAuthContext, targetType: string, targetId: string, detail: string): Promise<never> {
  await recordAuditEvent(db, {
    eventType: "workflow_permission_denied",
    actorUserId: ctx.actorUserId,
    organizationId: ctx.organizationId,
    targetType,
    targetId,
    metadata: { detail },
  });
  throw new InsufficientRoleError(detail);
}

/** Create a workflow definition: org owner/admin, or workspace manager for a workspace-scoped definition. */
export function requireWorkflowCreateAuthority(input: { orgRole: OrganizationRole; workspaceId: string | null; workspaceRole: WorkspaceRole | null }): void {
  const admin = input.orgRole === "owner" || input.orgRole === "admin";
  const workspaceManager = Boolean(input.workspaceId) && input.workspaceRole === "manager";
  if (admin || workspaceManager) return;
  throw new InsufficientRoleError("requires organization owner/admin, or workspace manager for a workspace-scoped workflow");
}

/** View a workflow definition: org owner/admin, or any workspace member for a workspace-scoped definition, or any organization member for an org-wide (non-workspace-scoped) definition — matching Projects Core's own "everyone in scope may view" floor. */
export async function requireWorkflowViewAuthority(db: Db, ctx: WorkflowAuthContext, definitionId: string): Promise<void> {
  if (isOrgAdmin(ctx)) return;
  if (ctx.isWorkspaceScoped ? ctx.workspaceRole !== null : true) return;
  await denyAndAudit(db, ctx, "workflow_definition", definitionId, "requires workspace visibility");
}

/** Manage a workflow definition (edit, publish, pause, archive): org owner/admin, or this workspace's own manager. */
export async function requireWorkflowManageAuthority(db: Db, ctx: WorkflowAuthContext, definitionId: string): Promise<void> {
  if (isOrgAdmin(ctx) || isWorkspaceManager(ctx)) return;
  await denyAndAudit(db, ctx, "workflow_definition", definitionId, "requires organization owner/admin, or workspace manager for a workspace-scoped workflow");
}

/** Start an execution of a published workflow: org owner/admin, workspace manager, or (when the execution is being started against a specific project) that project's own owner/manager. */
export async function requireWorkflowStartAuthority(db: Db, ctx: WorkflowAuthContext, definitionId: string, projectId: string | null): Promise<void> {
  if (isOrgAdmin(ctx) || isWorkspaceManager(ctx)) return;
  const projectRole = await resolveProjectRole(db, projectId, ctx.actorUserId);
  if (projectRole === "project_owner" || projectRole === "project_manager") return;
  await denyAndAudit(db, ctx, "workflow_definition", definitionId, "requires organization owner/admin, workspace manager, or project owner/manager of the linked project");
}

/** Inspect a specific execution: the start-authority floor, plus any workspace member (if workspace-scoped) or any member of the linked project (view-only). */
export async function requireWorkflowExecutionViewAuthority(db: Db, ctx: WorkflowAuthContext, executionId: string, projectId: string | null): Promise<void> {
  if (isOrgAdmin(ctx) || isWorkspaceManager(ctx)) return;
  if (ctx.isWorkspaceScoped && ctx.workspaceRole !== null) return;
  const projectRole = await resolveProjectRole(db, projectId, ctx.actorUserId);
  if (projectRole !== null) return;
  if (!ctx.isWorkspaceScoped && !projectId) return; // org-wide, unscoped workflow — visible org-wide, matching definition visibility above
  await denyAndAudit(db, ctx, "workflow_execution", executionId, "requires workspace or project visibility");
}

/** Pause/resume/cancel/retry an execution: org owner/admin, workspace manager, the execution's own initiator, or project owner/manager of the linked project. */
export async function requireWorkflowExecutionManageAuthority(db: Db, ctx: WorkflowAuthContext, executionId: string, input: { initiatorUserId: string | null; projectId: string | null }): Promise<void> {
  if (isOrgAdmin(ctx) || isWorkspaceManager(ctx)) return;
  if (input.initiatorUserId === ctx.actorUserId) return;
  const projectRole = await resolveProjectRole(db, input.projectId, ctx.actorUserId);
  if (projectRole === "project_owner" || projectRole === "project_manager") return;
  await denyAndAudit(db, ctx, "workflow_execution", executionId, "requires organization owner/admin, workspace manager, the execution's own initiator, or project owner/manager of the linked project");
}
