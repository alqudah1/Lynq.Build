export { db, rawSql, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, addOrgMember, makeAgent, makeTestWorkspace, addWorkspaceMember } from "@/lib/analytics-os/test-helpers";

import { db, makeUser, addOrgMember } from "@/lib/analytics-os/test-helpers";
import { grantFounderRole } from "./roles";
import type { FounderRole } from "./validation";

function randKey(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

/** A real org member with an active Founder Workspace role, ready to be an actor. */
export async function makeFounderUser(orgId: string, role: FounderRole = "founder_viewer", grantedByUserId?: string): Promise<string> {
  const userId = await makeUser();
  await addOrgMember(orgId, userId, "member");
  await grantFounderRole(db, { organizationId: orgId, userId, role, actorUserId: grantedByUserId ?? userId });
  return userId;
}

export function randFounderKey(prefix: string): string {
  return randKey(prefix);
}
