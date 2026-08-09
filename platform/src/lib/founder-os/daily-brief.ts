import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { computeCompanyPulse } from "./company-pulse";
import { computeAttentionItems, type AttentionItem } from "./attention-engine";
import { listFounderApprovals } from "./approval-center";
import { resolveFounderAuthContext, requireFounderViewAuthority, hasFounderCapability } from "./authz";
import { runAnalyticsQuery } from "@/lib/analytics-os/query";
import type { ExecutiveKpiGroup } from "@/lib/analytics-os/kpis";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface DailyBriefMetricChange {
  metricKey: string;
  name: string;
  current: number | null;
  previous: number | null;
  percentChange: number | null;
}

export interface DailyBrief {
  organizationId: string;
  workspaceId: string | null;
  generatedAt: string;
  companySnapshot: ExecutiveKpiGroup[];
  changesSincePreviousDay: DailyBriefMetricChange[];
  attentionItems: AttentionItem[];
  approvalsPendingCount: number;
  suggestedActions: { title: string; recommendedActionType: string; recordType: string; recordId: string }[];
}

/** A small, fixed, cross-domain set of headline metrics for the "changes since previous day" section — never the full registry, to keep this section scannable in a few seconds. */
const HEADLINE_METRIC_KEYS = ["crm_leads_open", "crm_won_value", "workflows_failed", "communications_messages_sent", "agent_executions_failed"];

/**
 * ============================================================================
 * Founder daily brief — Module 18
 * ============================================================================
 * Fully deterministic — no LLM call anywhere in this function. Every
 * section reuses an already-built real service (`computeCompanyPulse`,
 * `computeAttentionItems`, `listFounderApprovals`) — this file adds no new
 * data computation of its own beyond the "changes since previous day"
 * comparison and restating the top attention items as "suggested actions"
 * (never a new narrative, never an invented insight unsupported by data).
 */
export async function computeDailyBrief(db: Db, input: { organizationId: string; workspaceId: string | null; actorUserId: string }): Promise<DailyBrief> {
  const ctx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderViewAuthority(db, ctx, "founder_daily_brief", input.organizationId);

  const now = new Date();
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const [companySnapshot, attentionItems, approvals] = await Promise.all([
    computeCompanyPulse(db, { organizationId: input.organizationId, workspaceId: input.workspaceId, actorUserId: input.actorUserId }),
    computeAttentionItems(db, { organizationId: input.organizationId, workspaceId: input.workspaceId, actorUserId: input.actorUserId }),
    listFounderApprovals(db, { organizationId: input.organizationId, actorUserId: input.actorUserId }),
  ]);

  const canSeeFinancials = hasFounderCapability(ctx, "founder_workspace_view_financial");
  const headlineKeys = HEADLINE_METRIC_KEYS.filter((k) => canSeeFinancials || k !== "crm_won_value");

  let changesSincePreviousDay: DailyBriefMetricChange[] = [];
  try {
    const result = await runAnalyticsQuery(db, {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      metricKeys: headlineKeys,
      dateRangeStrategy: "custom",
      customFrom: startOfToday,
      customTo: now,
      comparisonStrategy: "previous_period",
      recordAudit: false,
    });
    changesSincePreviousDay = result.metrics.map((m) => ({
      metricKey: m.metricKey,
      name: m.name,
      current: m.current.points[0]?.value ?? null,
      previous: m.previous?.points[0]?.value ?? null,
      percentChange: m.comparison?.percentChange ?? null,
    }));
  } catch {
    changesSincePreviousDay = [];
  }

  const suggestedActions = attentionItems.slice(0, 5).map((item) => ({ title: item.title, recommendedActionType: item.recommendedActionType, recordType: item.recordType, recordId: item.recordId }));

  return {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    generatedAt: now.toISOString(),
    companySnapshot,
    changesSincePreviousDay,
    attentionItems,
    approvalsPendingCount: approvals.length,
    suggestedActions,
  };
}

/** Renders a bounded, plain-text version of the brief — the exact content stored on the report artifact the Founder Analyst agent task produces. */
export function formatDailyBriefAsText(brief: DailyBrief): string {
  const lines: string[] = [];
  lines.push(`Founder Daily Brief — ${brief.generatedAt}`);
  lines.push("");
  lines.push("Company snapshot:");
  for (const group of brief.companySnapshot) {
    for (const metric of group.metrics) {
      const value = metric.current.points[0]?.value;
      lines.push(`  [${group.group}] ${metric.name}: ${value ?? "—"} (${metric.classification})`);
    }
  }
  lines.push("");
  lines.push("Changes since previous day:");
  for (const change of brief.changesSincePreviousDay) {
    lines.push(`  ${change.name}: ${change.current ?? "—"} (previous: ${change.previous ?? "—"}, change: ${change.percentChange !== null ? `${change.percentChange}%` : "—"})`);
  }
  lines.push("");
  lines.push(`Attention items (${brief.attentionItems.length}):`);
  for (const item of brief.attentionItems.slice(0, 20)) {
    lines.push(`  [${item.severity}] ${item.title}`);
  }
  lines.push("");
  lines.push(`Approvals pending: ${brief.approvalsPendingCount}`);
  lines.push("");
  lines.push("Suggested executive actions (deterministic prioritization, not AI judgment):");
  for (const action of brief.suggestedActions) {
    lines.push(`  - ${action.title} (${action.recommendedActionType})`);
  }
  return lines.join("\n");
}
