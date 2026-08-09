import { brainPermissionGrants } from "@/db/schema";
import { seedKnowledgeAnalystAgent } from "@/lib/agents/knowledge-analyst";
import type { KnowledgeDomain } from "@/lib/brain/knowledge-items";

export { db, rawSql, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, ensureToolsSeeded, makeKnowledgeItem, makeAgent, pollUntilJobDone } from "@/lib/agent-runtime/test-helpers";
export { addOrgMember, makeProject } from "@/lib/projects/test-helpers";

import { db } from "@/lib/agent-runtime/test-helpers";

async function grantOwnerCapability(orgId: string, ownerId: string, domain: KnowledgeDomain, capability: "read" | "draft_write") {
  await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain, workspaceId: null, granteeUserId: ownerId, granteeType: "human", capability }).onConflictDoNothing();
}

/** Every workflow test that touches a `company_knowledge_report` `agent_execution` node, or an `approval`/`tool_invocation`/`artifact_transform` node, needs a real, seeded Knowledge Analyst. As of Module 14, `agent_execution` also supports `sales_lead_research`/`sales_opportunity_summary` via `seedSalesAgents` (`@/lib/sales-os/agents`) — not needed here. */
export async function seedAnalystForWorkflowTests(orgId: string, ownerId: string, allowedDomains: KnowledgeDomain[] = ["identity"]) {
  for (const domain of allowedDomains) {
    await grantOwnerCapability(orgId, ownerId, domain, "read");
  }
  return seedKnowledgeAnalystAgent(db, { organizationId: orgId, humanOwnerUserId: ownerId, allowedDomains, actorUserId: ownerId });
}
