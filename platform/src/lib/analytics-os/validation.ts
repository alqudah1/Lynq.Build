import { z } from "zod";

export const ANALYTICS_TIME_GRAINS = ["day", "week", "month", "quarter"] as const;
export type AnalyticsTimeGrain = (typeof ANALYTICS_TIME_GRAINS)[number];

export const ANALYTICS_ROLES = ["analytics_admin", "analytics_manager", "viewer"] as const;
export type AnalyticsRole = (typeof ANALYTICS_ROLES)[number];

export const ANALYTICS_CAPABILITIES = [
  "analytics_view",
  "analytics_view_sales",
  "analytics_view_marketing",
  "analytics_view_crm",
  "analytics_view_communications",
  "analytics_view_projects",
  "analytics_view_workflows",
  "analytics_view_agents",
  "analytics_manage_reports",
  "analytics_admin",
] as const;
export type AnalyticsCapability = (typeof ANALYTICS_CAPABILITIES)[number];

export const ANALYTICS_DOMAINS = ["crm", "sales", "marketing", "communications", "projects", "workflows", "agents"] as const;
export type AnalyticsDomain = (typeof ANALYTICS_DOMAINS)[number];

/** The capability that gates AGGREGATE metric access for each domain — checked in ADDITION to the source module's own aggregate-safe view authority, never in place of it. */
export const DOMAIN_VIEW_CAPABILITY: Record<AnalyticsDomain, AnalyticsCapability> = {
  crm: "analytics_view_crm",
  sales: "analytics_view_sales",
  marketing: "analytics_view_marketing",
  communications: "analytics_view_communications",
  projects: "analytics_view_projects",
  workflows: "analytics_view_workflows",
  agents: "analytics_view_agents",
};

export const ANALYTICS_DATE_RANGE_STRATEGIES = ["last_7_days", "last_30_days", "last_90_days", "month_to_date", "quarter_to_date", "year_to_date", "custom"] as const;
export type AnalyticsDateRangeStrategy = (typeof ANALYTICS_DATE_RANGE_STRATEGIES)[number];

export const ANALYTICS_VISUALIZATIONS = ["kpi_card", "line", "bar", "table", "funnel", "progress", "status_distribution"] as const;
export type AnalyticsVisualization = (typeof ANALYTICS_VISUALIZATIONS)[number];

export const ANALYTICS_REPORT_VISIBILITIES = ["private", "organization"] as const;

export const MAX_METRIC_KEYS_PER_QUERY = 20;
export const MAX_DATE_RANGE_DAYS = 400; // a little over a year — bounds unbounded ranges without blocking a genuine year-over-year view.
export const MAX_GROUP_BY_CARDINALITY = 100;
export const MAX_DRILLDOWN_ROWS = 200;

export const dateRangeSchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .strict()
  .refine((r) => r.from <= r.to, { message: "from must be <= to" })
  .refine((r) => (r.to.getTime() - r.from.getTime()) / (1000 * 60 * 60 * 24) <= MAX_DATE_RANGE_DAYS, { message: `date range exceeds the maximum of ${MAX_DATE_RANGE_DAYS} days` });

export const reportNameSchema = z.string().trim().min(1).max(200);
