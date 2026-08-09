export { db, rawSql, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, makeAgent, makeAgentWithCredential, grantAgentCapability, authedRequest } from "@/lib/agent-runtime/test-helpers";
export { addOrgMember, makeProject } from "@/lib/projects/test-helpers";

import { db } from "@/lib/agent-runtime/test-helpers";
import { createPipeline } from "./pipelines";
import { createStage } from "./stages";
import { createContact } from "./contacts";
import { createCompany } from "./companies";

/** Standard test pipeline: New (open) -> Qualified (open) -> Won (closed/won) / Lost (closed/lost). */
export async function makeTestPipeline(orgId: string, ownerId: string) {
  const pipeline = await createPipeline(db, { organizationId: orgId, name: "Test Pipeline", pipelineKey: `PIPE_${Math.random().toString(36).slice(2, 8).toUpperCase()}`, actorUserId: ownerId });
  const newStage = await createStage(db, { organizationId: orgId, pipelineId: pipeline.id, name: "New", stageKey: "NEW", actorUserId: ownerId });
  const qualifiedStage = await createStage(db, { organizationId: orgId, pipelineId: pipeline.id, name: "Qualified", stageKey: "QUALIFIED", actorUserId: ownerId });
  const wonStage = await createStage(db, { organizationId: orgId, pipelineId: pipeline.id, name: "Won", stageKey: "WON", isClosed: true, isWon: true, actorUserId: ownerId });
  const lostStage = await createStage(db, { organizationId: orgId, pipelineId: pipeline.id, name: "Lost", stageKey: "LOST", isClosed: true, isLost: true, actorUserId: ownerId });
  return { pipeline, newStage, qualifiedStage, wonStage, lostStage };
}

export async function makeTestContact(orgId: string, ownerId: string, overrides: Partial<{ displayName: string; primaryEmail: string; primaryPhone: string }> = {}) {
  const { contact } = await createContact(db, { organizationId: orgId, displayName: overrides.displayName ?? "Test Contact", primaryEmail: overrides.primaryEmail, primaryPhone: overrides.primaryPhone, actorUserId: ownerId });
  return contact;
}

export async function makeTestCompany(orgId: string, ownerId: string, overrides: Partial<{ name: string; domain: string }> = {}) {
  const { company } = await createCompany(db, { organizationId: orgId, name: overrides.name ?? "Test Company", domain: overrides.domain, actorUserId: ownerId });
  return company;
}
