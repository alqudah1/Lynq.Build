import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { and, eq, desc, inArray } from "drizzle-orm";
import { auditLogs } from "@/db/schema";
import { resolveFounderAuthContext, requireFounderViewAuthority, hasFounderCapability } from "./authz";
import { MAX_ACTIVITY_FEED_ITEMS } from "./validation";
import type { FounderCapability } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface ActivityFeedItem {
  id: string;
  eventType: string;
  targetType: string | null;
  targetId: string | null;
  actorUserId: string | null;
  actorAgentId: string | null;
  createdAt: string;
}

/**
 * The exact, curated set of "executive-meaningful" canonical audit event
 * types — never every audit event (this is an operational feed, not the
 * compliance log). Each maps to a real, already-fired event elsewhere in
 * this codebase; nothing here is invented. Two spec examples are
 * deliberately NOT included, disclosed rather than faked: "new HIGH-
 * PRIORITY lead" (no canonical field distinguishes priority at the audit-
 * event layer — `crm_lead_created` is included un-filtered instead, which
 * is honest but broader than "high-priority only"), and "major target
 * milestone" (no such event is ever fired anywhere in this codebase today
 * — Sales OS records target creation/update only, never a progress-
 * threshold-crossing event).
 */
const FEED_EVENT_DOMAIN: Record<string, FounderCapability> = {
  project_status_changed: "founder_workspace_view_operations",
  crm_opportunity_won: "founder_workspace_view_sales",
  crm_opportunity_lost: "founder_workspace_view_sales",
  crm_lead_created: "founder_workspace_view_sales",
  marketing_campaign_status_changed: "founder_workspace_view_marketing",
  workflow_execution_completed: "founder_workspace_view_operations",
  workflow_execution_failed: "founder_workspace_view_operations",
  communication_message_failed: "founder_workspace_view_operations",
  agent_execution_completed: "founder_workspace_view_agents",
  agent_execution_failed: "founder_workspace_view_agents",
  agent_approval_requested: "founder_workspace_view_agents",
  founder_approval_decided: "founder_workspace_view_agents",
};

export async function computeExecutiveActivityFeed(db: Db, input: { organizationId: string; actorUserId: string; limit?: number }): Promise<ActivityFeedItem[]> {
  const ctx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderViewAuthority(db, ctx, "founder_activity_feed", input.organizationId);

  const allowedEventTypes = Object.entries(FEED_EVENT_DOMAIN)
    .filter(([, capability]) => hasFounderCapability(ctx, capability))
    .map(([eventType]) => eventType);
  if (allowedEventTypes.length === 0) return [];

  const limit = Math.min(input.limit ?? MAX_ACTIVITY_FEED_ITEMS, MAX_ACTIVITY_FEED_ITEMS);
  const rows = await db
    .select({ id: auditLogs.id, eventType: auditLogs.eventType, targetType: auditLogs.targetType, targetId: auditLogs.targetId, actorUserId: auditLogs.actorUserId, actorAgentId: auditLogs.actorAgentId, createdAt: auditLogs.createdAt })
    .from(auditLogs)
    .where(and(eq(auditLogs.organizationId, input.organizationId), inArray(auditLogs.eventType, allowedEventTypes)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);

  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}
