export { db, rawSql, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, addOrgMember } from "@/lib/crm/test-helpers";

import { db, makeUser, addOrgMember } from "@/lib/crm/test-helpers";
import { grantSalesRole } from "./roles";
import { createPlaybook, addPlaybookStep, publishPlaybookVersion } from "./playbooks";
import { createFollowUpSequence, addSequenceStep, publishSequenceVersion } from "./sequences";
import type { SalesRole, SalesPlaybookType, SalesSequenceTargetType } from "./validation";

function randKey(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

/** A real org member with an active Sales OS role, ready to be an assignment target or actor. */
export async function makeSalesRepUser(orgId: string, role: SalesRole = "sales_rep", grantedByUserId?: string): Promise<string> {
  const userId = await makeUser();
  await addOrgMember(orgId, userId, "member");
  await grantSalesRole(db, { organizationId: orgId, userId, role, actorUserId: grantedByUserId ?? userId });
  return userId;
}

/** A published, one-step playbook — the minimum a qualification/opportunity run needs to start. */
export async function makeTestPlaybook(orgId: string, actorUserId: string, playbookType: SalesPlaybookType = "lead_qualification") {
  const { playbook, version } = await createPlaybook(db, { organizationId: orgId, name: "Test Playbook", playbookKey: randKey("PB"), playbookType, actorUserId });
  await addPlaybookStep(db, { organizationId: orgId, playbookVersionId: version.id, stepKey: "CONFIRM", stepType: "checklist", name: "Confirm details", sequence: 0, actorUserId });
  const published = await publishPlaybookVersion(db, { organizationId: orgId, playbookId: playbook.id, versionId: version.id, expectedRevision: version.revision, actorUserId });
  return { playbook, version: published };
}

/** A published, one-step follow-up sequence with a `crm_follow_up` step due immediately (dayOffset 0). */
export async function makeTestSequence(orgId: string, actorUserId: string, targetType: SalesSequenceTargetType = "lead") {
  const { sequence, version } = await createFollowUpSequence(db, { organizationId: orgId, name: "Test Sequence", sequenceKey: randKey("SEQ"), targetType, actorUserId });
  await addSequenceStep(db, { organizationId: orgId, sequenceVersionId: version.id, stepKey: "STEP_0", dayOffset: 0, actionType: "crm_follow_up", title: "Day 0 outreach", sequence: 0, actorUserId });
  const published = await publishSequenceVersion(db, { organizationId: orgId, sequenceId: sequence.id, versionId: version.id, expectedRevision: version.revision, actorUserId });
  return { sequence, version: published };
}
