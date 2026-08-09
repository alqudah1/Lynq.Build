/**
 * The closed set of agent task types (Module 14) — split out from
 * `task-handlers.ts` deliberately: this file has no `"server-only"`
 * import (and must never gain one), since it's also read by client
 * components (`CreateNodeForm.tsx`'s config hints) and by
 * `workflows/validation.ts` (a schema module imported from both server
 * and client code). `task-handlers.ts` itself — the registry, the
 * handler contract, and every handler's actual server-side logic —
 * remains fully `"server-only"`.
 */
export const AGENT_TASK_TYPES = [
  "company_knowledge_report",
  "sales_lead_research",
  "sales_opportunity_summary",
  "marketing_campaign_brief",
  "marketing_content_draft",
  "marketing_campaign_summary",
  "communications_draft_reply",
  "communications_draft_follow_up",
  "founder_company_brief",
] as const;
export type AgentTaskType = (typeof AGENT_TASK_TYPES)[number];

export function isAgentTaskType(value: string): value is AgentTaskType {
  return (AGENT_TASK_TYPES as readonly string[]).includes(value);
}
