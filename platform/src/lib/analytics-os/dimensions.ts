/**
 * ============================================================================
 * Dimension registry — Module 17
 * ============================================================================
 * A fixed, in-code set of safe dimension KEYS — never an arbitrary database
 * column. Each metric's own `MetricDefinition.supportedDimensions` declares
 * which of these it may be grouped by; a metric's own `compute()`
 * implementation is what actually maps a dimension key to a real, bounded
 * column expression — this registry is the closed vocabulary + validation
 * gate, not a query builder. The same "no dynamic SQL, no arbitrary
 * expression" discipline Marketing OS's own audience filter registry
 * already established.
 */
export interface DimensionDefinition {
  dimensionKey: string;
  label: string;
  description: string;
}

export const DIMENSION_REGISTRY: Record<string, DimensionDefinition> = {
  time: { dimensionKey: "time", label: "Time", description: "Bucketed by the query's own time grain." },
  workspace: { dimensionKey: "workspace", label: "Workspace", description: "Grouped by workspace id." },
  owner: { dimensionKey: "owner", label: "Owner", description: "Grouped by the record's owning user id." },
  pipeline: { dimensionKey: "pipeline", label: "Pipeline", description: "Grouped by CRM pipeline id." },
  pipeline_stage: { dimensionKey: "pipeline_stage", label: "Pipeline stage", description: "Grouped by CRM pipeline stage id." },
  campaign: { dimensionKey: "campaign", label: "Campaign", description: "Grouped by Marketing campaign id." },
  campaign_status: { dimensionKey: "campaign_status", label: "Campaign status", description: "Grouped by Marketing campaign status." },
  source: { dimensionKey: "source", label: "Source", description: "Grouped by CRM source id." },
  channel: { dimensionKey: "channel", label: "Channel", description: "Grouped by communication channel (email/sms/whatsapp)." },
  provider: { dimensionKey: "provider", label: "Provider", description: "Grouped by integration provider." },
  project: { dimensionKey: "project", label: "Project", description: "Grouped by project id." },
  workflow: { dimensionKey: "workflow", label: "Workflow", description: "Grouped by workflow definition id." },
  agent: { dimensionKey: "agent", label: "Agent", description: "Grouped by agent id." },
  task_type: { dimensionKey: "task_type", label: "Agent task type", description: "Grouped by agent task type." },
  status: { dimensionKey: "status", label: "Status", description: "Grouped by the record's own canonical status." },
};

export function isKnownDimension(dimensionKey: string): boolean {
  return dimensionKey in DIMENSION_REGISTRY;
}

export function listDimensions(): DimensionDefinition[] {
  return Object.values(DIMENSION_REGISTRY);
}
