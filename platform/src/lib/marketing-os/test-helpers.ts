export { db, rawSql, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, addOrgMember } from "@/lib/crm/test-helpers";

import { db, makeUser, addOrgMember } from "@/lib/crm/test-helpers";
import { grantMarketingRole } from "./roles";
import { createPlaybook, addPlaybookStep, publishPlaybookVersion } from "./playbooks";
import type { MarketingRole, MarketingPlaybookType } from "./validation";

function randKey(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

/** A real org member with an active Marketing OS role, ready to be an actor. */
export async function makeMarketingUser(orgId: string, role: MarketingRole = "marketing_contributor", grantedByUserId?: string): Promise<string> {
  const userId = await makeUser();
  await addOrgMember(orgId, userId, "member");
  await grantMarketingRole(db, { organizationId: orgId, userId, role, actorUserId: grantedByUserId ?? userId });
  return userId;
}

/** A published, one-step playbook — the minimum a campaign run needs to start. */
export async function makeTestMarketingPlaybook(orgId: string, actorUserId: string, playbookType: MarketingPlaybookType = "campaign") {
  const { playbook, version } = await createPlaybook(db, { organizationId: orgId, name: "Test Marketing Playbook", playbookKey: randKey("MKPB"), playbookType, actorUserId });
  await addPlaybookStep(db, { organizationId: orgId, playbookVersionId: version.id, stepKey: "CONFIRM", stepType: "checklist", name: "Confirm details", sequence: 0, actorUserId });
  const published = await publishPlaybookVersion(db, { organizationId: orgId, playbookId: playbook.id, versionId: version.id, expectedRevision: version.revision, actorUserId });
  return { playbook, version: published };
}

export function randMarketingKey(prefix: string): string {
  return randKey(prefix);
}
