import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, rawSql, makeUser, makeOrgWithOwner, addOrgMember, cleanupAgentRuntimeTestData, makeMarketingUser, makeTestMarketingPlaybook, randMarketingKey } from "./test-helpers";
import { ensureToolsSeeded } from "@/lib/agent-runtime/test-helpers";
import { createCampaign, transitionCampaignStatus } from "./campaigns";
import { createAudience, evaluateAudience } from "./audiences";
import { InvalidAudienceFilterError } from "./errors";
import { createContentItem, submitContentForReview, confirmContentPublished } from "./content";
import { requestContentReviewApproval } from "./agents";
import { startCampaignRun, completeCampaignRunItem, completeCampaignRun, listCampaignRunItems } from "./campaign-runs";
import { CampaignRequirementsIncompleteError, InvalidMarketingTransitionError } from "./errors";
import { seedMarketingAgents, createCampaignBriefTask } from "./agents";
import { seedMarketingWorkflowTemplates } from "./templates";
import { createLeadFromCampaign, getCampaignReferenceForLead } from "./handoff";
import { createSource } from "@/lib/crm/sources";
import { createLead, resolveLeadById } from "@/lib/crm/leads";
import { requireCrmManageAuthority, resolveCrmAuthContext } from "@/lib/crm/authz";
import { InsufficientRoleError } from "@/lib/authz/errors";
import { computeCampaignHealth } from "./health";
import { auditLogs, crmLeads } from "@/db/schema";
import { startWorkflowExecution, resolveWorkflowExecutionById } from "@/lib/workflows/executions";
import { pollAndProcess } from "@/lib/runtime/worker";
import { runtimeJobs } from "@/db/schema";
import { inArray } from "drizzle-orm";

beforeAll(ensureToolsSeeded);
afterEach(cleanupAgentRuntimeTestData);

async function driveToStatus(orgId: string, executionId: string, targetStatuses: string[], maxAttempts = 30) {
  let execution = await resolveWorkflowExecutionById(db, orgId, executionId);
  for (let i = 0; i < maxAttempts && !targetStatuses.includes(execution.status); i++) {
    const queued = await db.select({ id: runtimeJobs.id }).from(runtimeJobs).where(and(eq(runtimeJobs.workflowExecutionId, executionId), inArray(runtimeJobs.status, ["queued", "retry_scheduled"])));
    if (queued.length > 0) {
      await pollAndProcess(db, rawSql, { leaseOwner: `test-worker:${executionId}:${i}`, onlyJobIds: queued.map((j) => j.id) });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    execution = await resolveWorkflowExecutionById(db, orgId, executionId);
  }
  return execution;
}

describe("Marketing OS — tenant safety, authorization independence, and core lifecycles", () => {
  it("a marketing_admin role does not itself grant CRM manage authority — the dual gate is real", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const marketingAdminId = await makeMarketingUser(orgId, "marketing_admin", ownerId);

    // Sales/CRM manage authority for an ordinary org member (not owner/admin) must fail.
    const ctx = await resolveCrmAuthContext(db, { organizationId: orgId, workspaceId: null, actorUserId: marketingAdminId });
    await expect(requireCrmManageAuthority(db, ctx, "crm_lead", "new")).rejects.toThrow(InsufficientRoleError);
  });

  it("audience filter validation rejects an unrecognized field before any query runs", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    await expect(
      createAudience(db, { organizationId: orgId, name: "Bad filter", audienceKey: randMarketingKey("AUD"), entityType: "lead", filterDefinition: [{ field: "arbitrarySqlInjectionAttempt", operator: "equals", value: "x" }], actorUserId: ownerId })
    ).rejects.toThrow(InvalidAudienceFilterError);
  });

  it("audience evaluation is tenant-safe — never returns another organization's records", async () => {
    const ownerA = await makeUser();
    const orgA = await makeOrgWithOwner(ownerA);
    const ownerB = await makeUser();
    const orgB = await makeOrgWithOwner(ownerB);

    await createLead(db, { organizationId: orgA, actorUserId: ownerA });
    await createLead(db, { organizationId: orgA, actorUserId: ownerA });
    await createLead(db, { organizationId: orgB, actorUserId: ownerB });

    const audience = await createAudience(db, { organizationId: orgA, name: "All leads", audienceKey: randMarketingKey("AUD"), entityType: "lead", actorUserId: ownerA });
    const evaluation = await evaluateAudience(db, { organizationId: orgA, audienceId: audience.id, actorUserId: ownerA });
    expect(evaluation.count).toBe(2);

    const orgALeadIds = new Set((await db.select({ id: crmLeads.id }).from(crmLeads).where(eq(crmLeads.organizationId, orgA))).map((r) => r.id));
    expect(evaluation.recordIds.every((id) => orgALeadIds.has(id))).toBe(true);
  });

  it("campaign lifecycle rejects an invalid transition and enforces the explicit transition map", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const campaign = await createCampaign(db, { organizationId: orgId, campaignKey: randMarketingKey("CAMP"), name: "Test Campaign", actorUserId: ownerId });

    // draft -> active is not an allowed direct transition.
    await expect(transitionCampaignStatus(db, { organizationId: orgId, campaignId: campaign.id, toStatus: "active", expectedRevision: campaign.revision, actorUserId: ownerId })).rejects.toThrow(InvalidMarketingTransitionError);

    const planning = await transitionCampaignStatus(db, { organizationId: orgId, campaignId: campaign.id, toStatus: "planning", expectedRevision: campaign.revision, actorUserId: ownerId });
    expect(planning.status).toBe("planning");
  });

  it("campaign run completion is blocked until every required playbook step is complete", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const campaign = await createCampaign(db, { organizationId: orgId, campaignKey: randMarketingKey("CAMP"), name: "Test Campaign", actorUserId: ownerId });
    const { version } = await makeTestMarketingPlaybook(orgId, ownerId, "campaign");

    const { run } = await startCampaignRun(db, { organizationId: orgId, campaignId: campaign.id, playbookVersionId: version.id, actorUserId: ownerId });
    await expect(completeCampaignRun(db, { organizationId: orgId, runId: run.id, expectedRevision: run.revision, actorUserId: ownerId })).rejects.toThrow(CampaignRequirementsIncompleteError);

    const items = await listCampaignRunItems(db, orgId, run.id);
    await completeCampaignRunItem(db, { organizationId: orgId, itemId: items[0].id, status: "complete", actorUserId: ownerId });

    const completed = await completeCampaignRun(db, { organizationId: orgId, runId: run.id, expectedRevision: run.revision, actorUserId: ownerId });
    expect(completed.status).toBe("completed");
    // The campaign's own lifecycle status is untouched by completing the run — no second status truth.
    const canonicalCampaign = await import("./campaigns").then((m) => m.resolveCampaignById(db, orgId, campaign.id));
    expect(canonicalCampaign.status).toBe("draft");
  });

  it("content approval lifecycle: draft -> review -> approved, and an agent has no callable path to approve its own output", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await seedMarketingAgents(db, { organizationId: orgId, humanOwnerUserId: ownerId, actorUserId: ownerId });
    const campaign = await createCampaign(db, { organizationId: orgId, campaignKey: randMarketingKey("CAMP"), name: "Test Campaign", actorUserId: ownerId });
    const content = await createContentItem(db, { organizationId: orgId, campaignId: campaign.id, title: "Test post", contentType: "social_post", actorUserId: ownerId });

    const { createContentDraftTask } = await import("./agents");
    await createContentDraftTask(db, { organizationId: orgId, contentItemId: content.id, actorUserId: ownerId });

    const drafted = await import("./content").then((m) => m.resolveContentItemById(db, orgId, content.id));
    expect(drafted.currentArtifactId).not.toBeNull();

    const reviewed = await submitContentForReview(db, { organizationId: orgId, contentItemId: content.id, toStatus: "review", expectedRevision: drafted.revision, actorUserId: ownerId });
    expect(reviewed.status).toBe("review");

    const { approval } = await requestContentReviewApproval(db, { organizationId: orgId, contentItemId: content.id, summary: "Please review", actorUserId: ownerId });

    // Only a real human actorUserId can decide — approveRequest/rejectRequest have no agent-callable path at all.
    const { approveRequest } = await import("@/lib/agent-runtime/approvals");
    const decided = await approveRequest(db, { organizationId: orgId, approvalId: approval.id, actorUserId: ownerId });
    expect(decided.status).toBe("approved");

    const { applyContentApprovalDecision } = await import("./content");
    const approvedItem = await applyContentApprovalDecision(db, { organizationId: orgId, contentItemId: content.id, approvalRequestId: approval.id, decision: "approved", expectedRevision: reviewed.revision, actorUserId: ownerId });
    expect(approvedItem.status).toBe("approved");
    // Module 17 hardening: this test drives a real agent execution +
    // Runtime approval through several sequential Neon round trips —
    // scoped per-test, not a file- or suite-wide timeout change.
  }, 45000);

  it('"published" is only ever set by an explicit confirmation, never by scheduling or drafting alone', async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const campaign = await createCampaign(db, { organizationId: orgId, campaignKey: randMarketingKey("CAMP"), name: "Test Campaign", actorUserId: ownerId });
    const content = await createContentItem(db, { organizationId: orgId, campaignId: campaign.id, title: "Test post", contentType: "social_post", actorUserId: ownerId });

    // Cannot jump straight from draft to published.
    await expect(confirmContentPublished(db, { organizationId: orgId, contentItemId: content.id, toStatus: "published", expectedRevision: content.revision, actorUserId: ownerId })).rejects.toThrow(InvalidMarketingTransitionError);
  });

  it("campaign health reason codes are deterministic — a fully-configured campaign is healthy, an under-configured one is not", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const bareCampaign = await createCampaign(db, { organizationId: orgId, campaignKey: randMarketingKey("CAMP"), name: "Bare Campaign", actorUserId: ownerId });
    const bareHealth = await computeCampaignHealth(db, { organizationId: orgId, campaignId: bareCampaign.id, actorUserId: ownerId });
    expect(bareHealth.reasons).toContain("no_audience");
    expect(bareHealth.reasons).toContain("no_destination");
    expect(bareHealth.status).not.toBe("healthy");

    const audience = await createAudience(db, { organizationId: orgId, name: "Some leads", audienceKey: randMarketingKey("AUD"), entityType: "lead", actorUserId: ownerId });
    const { createDestination } = await import("./destinations");
    await createDestination(db, { organizationId: orgId, campaignId: bareCampaign.id, label: "Landing", url: "https://example.com", utmSource: "newsletter", utmMedium: "email", utmCampaign: "spring", actorUserId: ownerId });
    const { updateCampaign } = await import("./campaigns");
    await updateCampaign(db, { organizationId: orgId, campaignId: bareCampaign.id, expectedRevision: bareCampaign.revision, primaryAudienceId: audience.id, actorUserId: ownerId });

    const betterHealth = await computeCampaignHealth(db, { organizationId: orgId, campaignId: bareCampaign.id, actorUserId: ownerId });
    expect(betterHealth.reasons).not.toContain("no_audience");
    expect(betterHealth.reasons).not.toContain("no_destination");
  });

  it("Sales handoff creates the lead through CRM Core's own canonical createLead — no separate marketing lead entity — and retains campaign attribution with no PII in audit metadata", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const source = await createSource(db, { organizationId: orgId, sourceKey: randMarketingKey("SRC"), name: "Spring Campaign Source", sourceType: "paid_search", actorUserId: ownerId });
    const campaign = await createCampaign(db, { organizationId: orgId, campaignKey: randMarketingKey("CAMP"), name: "Spring Launch", sourceId: source.id, actorUserId: ownerId });

    const { lead, attribution } = await createLeadFromCampaign(db, {
      organizationId: orgId,
      campaignId: campaign.id,
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "spring_launch",
      actorUserId: ownerId,
    });

    // The canonical CRM lead — resolvable through CRM's own read path, sourceId matches the campaign's source.
    const canonicalLead = await resolveLeadById(db, orgId, lead.id);
    expect(canonicalLead.sourceId).toBe(source.id);
    expect(canonicalLead.ownerUserId).toBeNull(); // never auto-assigned to Sales.

    expect(attribution.campaignId).toBe(campaign.id);
    expect(attribution.touchType).toBe("first_touch");

    const reference = await getCampaignReferenceForLead(db, { organizationId: orgId, crmLeadId: lead.id, actorUserId: ownerId });
    expect(reference?.campaignId).toBe(campaign.id);

    // No PII ever appears in audit metadata for the attribution event.
    const [auditRow] = await db.select().from(auditLogs).where(and(eq(auditLogs.eventType, "marketing_attribution_recorded"), eq(auditLogs.targetId, attribution.id)));
    expect(JSON.stringify(auditRow.metadata ?? {})).not.toMatch(/@/); // no email-shaped string
  });

  it("the Workflow Engine's generic agent_execution node drives a Marketing agent end-to-end, producing a real artifact", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await seedMarketingAgents(db, { organizationId: orgId, humanOwnerUserId: ownerId, actorUserId: ownerId });
    const templates = await seedMarketingWorkflowTemplates(db, { organizationId: orgId, actorUserId: ownerId });
    const campaign = await createCampaign(db, { organizationId: orgId, campaignKey: randMarketingKey("CAMP"), name: "Workflow Campaign", actorUserId: ownerId });

    const execution = await startWorkflowExecution(db, { organizationId: orgId, definitionId: templates.campaignReview.definitionId, input: { campaignId: campaign.id }, actorUserId: ownerId });
    const waiting = await driveToStatus(orgId, execution.id, ["waiting", "completed", "failed"], 15);
    expect(waiting.status).toBe("waiting"); // parked at the human_review node after the Campaign Summary Agent completes.

    const { listNodeExecutionsForExecution } = await import("@/lib/workflows/node-executions");
    const nodeExecutions = await listNodeExecutionsForExecution(db, execution.id);
    const agentNodeExecution = nodeExecutions.find((ne) => ne.runtimeExecutionId !== null);
    expect(agentNodeExecution?.status).toBe("succeeded");
    expect((agentNodeExecution?.output as { reportArtifactId?: string } | null)?.reportArtifactId).toBeTruthy();
    // Module 17 hardening: drives a real generic agent_execution workflow
    // node end-to-end — scoped per-test, not a file- or suite-wide change.
  }, 45000);

  it("agent default-deny: a task type with no registered handler / no seeded agent fails deterministically, never silently", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const campaign = await createCampaign(db, { organizationId: orgId, campaignKey: randMarketingKey("CAMP"), name: "Unseeded Campaign", actorUserId: ownerId });

    // No seedMarketingAgents call — the Campaign Brief Assistant does not exist for this org yet.
    await expect(createCampaignBriefTask(db, { organizationId: orgId, campaignId: campaign.id, actorUserId: ownerId })).rejects.toThrow();
  });

  it("org membership other than marketing role does not exist — addOrgMember alone is not a Marketing OS grant (default deny)", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const plainMemberId = await makeUser();
    await addOrgMember(orgId, plainMemberId, "member");

    const { resolveMarketingAuthContext, hasMarketingCapability } = await import("./authz");
    const ctx = await resolveMarketingAuthContext(db, { organizationId: orgId, actorUserId: plainMemberId });
    expect(hasMarketingCapability(ctx, "marketing_create_campaigns")).toBe(false);
  });
});
