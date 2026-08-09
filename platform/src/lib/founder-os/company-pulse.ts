import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { computeExecutiveKpis, type ExecutiveKpiGroup } from "@/lib/analytics-os/kpis";
import type { AnalyticsDateRangeStrategy } from "@/lib/analytics-os/validation";
import type { ComparisonStrategy } from "@/lib/analytics-os/time";
import { resolveFounderAuthContext, requireFounderViewAuthority, hasFounderCapability } from "./authz";
import type { FounderCapability } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Company Pulse — Module 18
 * ============================================================================
 * A thin, permission-gated wrapper over Analytics OS's own executive KPI
 * layer (`computeExecutiveKpis`) — no new metric computation, no
 * competing business truth. "Founder Workspace permission does not bypass
 * source-module privacy": this file's own gate runs FIRST (founder
 * capability), then Analytics OS's own central + per-metric dual gate runs
 * SECOND, inside `computeExecutiveKpis` itself, exactly as it would for
 * any other Analytics caller — never skipped, never assumed satisfied.
 *
 * The spec's `founder_workspace_view_financial` capability has no direct
 * Analytics-OS-side equivalent (Analytics OS's own capabilities are
 * per-domain, not per-value-type) — enforced HERE instead, by dropping
 * every `currency`-valued metric from the response for a caller who holds
 * base view access to a domain but not the financial capability. A
 * founder_viewer therefore still sees counts/rates (e.g. "3 opportunities
 * at risk") but not dollar amounts (e.g. weighted pipeline value) unless
 * they hold `founder_workspace_view_financial`.
 */
const GROUP_TO_FOUNDER_CAPABILITY: Record<string, FounderCapability> = {
  growth: "founder_workspace_view",
  sales: "founder_workspace_view_sales",
  marketing: "founder_workspace_view_marketing",
  delivery: "founder_workspace_view_operations",
  operations: "founder_workspace_view_operations",
  communications: "founder_workspace_view_operations",
  ai: "founder_workspace_view_agents",
};

export interface CompanyPulseInput {
  organizationId: string;
  workspaceId: string | null;
  actorUserId: string;
  dateRangeStrategy?: AnalyticsDateRangeStrategy;
  comparisonStrategy?: ComparisonStrategy;
}

export async function computeCompanyPulse(db: Db, input: CompanyPulseInput): Promise<ExecutiveKpiGroup[]> {
  const ctx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderViewAuthority(db, ctx, "founder_company_pulse", input.organizationId);

  const groups = await computeExecutiveKpis(db, {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    dateRangeStrategy: input.dateRangeStrategy,
    comparisonStrategy: input.comparisonStrategy,
    recordAudit: false,
  });

  const canSeeFinancials = hasFounderCapability(ctx, "founder_workspace_view_financial");

  return groups
    .filter((group) => hasFounderCapability(ctx, GROUP_TO_FOUNDER_CAPABILITY[group.group] ?? "founder_workspace_view"))
    .map((group) => ({ ...group, metrics: group.metrics.filter((metric) => canSeeFinancials || metric.valueType !== "currency") }))
    .filter((group) => group.metrics.length > 0);
}
