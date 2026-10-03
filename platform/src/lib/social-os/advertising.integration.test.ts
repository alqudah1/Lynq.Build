import { describe, it, expect, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { agentApprovalRequests, runtimeJobs, socialAdChangeRequests } from "@/db/schema";
import { InsufficientRoleError, TenantResourceNotFoundError } from "@/lib/authz/errors";
import { db, makeSocialOrg, makeConnectedAccount, makeManualAccount, makeMarketingUser, cleanupAgentRuntimeTestData, fakeFetch } from "./test-helpers";
import { cancelAdChange, decideAdChange, executeAdChangeRequest, getAdCommandCenter, proposeAdChange, submitAdChangeForApproval } from "./advertising";
import { SocialAdChangeNotExecutableError } from "./errors";

const META_ENV = { META_APP_ID: "test-app", META_APP_SECRET: "test-app-secret", META_GRAPH_API_VERSION: "v25.0" };

async function setup() {
  const { orgId, ownerId, brand } = await makeSocialOrg();
  const actId = `${Math.floor(Math.random() * 1e9)}`;
  const { account } = await makeConnectedAccount(orgId, brand.id, "meta_ads", { externalAccountId: `act_${actId}` });
  const manager = await makeMarketingUser(orgId, "marketing_manager", ownerId);
  return { orgId, ownerId, brand, account, manager };
}

describe("advertising command center (integration)", () => {
  afterEach(cleanupAgentRuntimeTestData);

  it("propose → submit → approve queues the job → execute pauses the campaign and records the result", async () => {
    const s = await setup();
    const proposed = await proposeAdChange(db, { organizationId: s.orgId, channelAccountId: s.account.id, actorUserId: s.manager, changeType: "pause_campaign", title: "Pause Fall leads", rationale: "CTR fell by half", payload: { externalCampaignId: "c1" } });
    expect(proposed).toMatchObject({ status: "proposed", externalCampaignId: "c1", platform: "meta_ads", proposedByUserId: s.manager });

    const submitted = await submitAdChangeForApproval(db, { organizationId: s.orgId, changeRequestId: proposed.id, actorUserId: s.manager, expectedRevision: proposed.revision });
    expect(submitted.status).toBe("pending_approval");
    expect(submitted.approvalRequestId).toBeTruthy();
    const [approval] = await db.select().from(agentApprovalRequests).where(eq(agentApprovalRequests.id, submitted.approvalRequestId!));
    expect(approval).toMatchObject({ status: "pending", riskLevel: "high", requestedAction: "execute_ad_change" });

    // A manager can propose and submit but cannot approve spend changes.
    await expect(decideAdChange(db, { organizationId: s.orgId, changeRequestId: proposed.id, actorUserId: s.manager, expectedRevision: submitted.revision, decision: "approve" })).rejects.toBeInstanceOf(InsufficientRoleError);

    const approved = await decideAdChange(db, { organizationId: s.orgId, changeRequestId: proposed.id, actorUserId: s.ownerId, expectedRevision: submitted.revision, decision: "approve", note: "Go" });
    expect(approved).toMatchObject({ status: "approved", approvedByUserId: s.ownerId, decisionNote: "Go" });
    const [job] = await db.select().from(runtimeJobs).where(and(eq(runtimeJobs.organizationId, s.orgId), eq(runtimeJobs.idempotencyKey, `social_ad_change_execute:${proposed.id}`)));
    expect(job).toBeTruthy();
    expect(job.maxAttempts).toBe(1);
    expect(approved.runtimeJobId).toBe(job.id);

    const { fetchImpl, calls } = fakeFetch([{ match: (u, i) => i?.method === "POST" && /\/v25\.0\/c1(\?|$)/.test(u), respond: () => ({ json: { success: true } }) }]);
    const result = await executeAdChangeRequest(db, { organizationId: s.orgId, changeRequestId: proposed.id, deps: { fetchImpl, env: META_ENV } });
    expect(result).toMatchObject({ status: "executed", externalIds: { campaignId: "c1" } });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ status: "PAUSED" });
    const [row] = await db.select().from(socialAdChangeRequests).where(eq(socialAdChangeRequests.id, proposed.id));
    expect(row.status).toBe("executed");
    expect(row.executedAt).not.toBeNull();
    expect(row.externalResult).toMatchObject({ externalIds: { campaignId: "c1" } });

    // Re-running the job is a no-op, never a second provider call.
    const again = await executeAdChangeRequest(db, { organizationId: s.orgId, changeRequestId: proposed.id, deps: { fetchImpl, env: META_ENV } });
    expect(again.alreadyExecuted).toBe(true);
    expect(calls).toHaveLength(1);

    const center = await getAdCommandCenter(db, { organizationId: s.orgId, actorUserId: s.ownerId });
    expect(center.accounts.map((a) => a.id)).toEqual([s.account.id]);
    expect(center.changeRequests.map((c) => c.id)).toContain(proposed.id);
    expect(center.dataNotes.join(" ")).toMatch(/No synced campaign data/);
  });

  it("refuses to execute without a recorded approval — even when the row was forced to approved", async () => {
    const s = await setup();
    const proposed = await proposeAdChange(db, { organizationId: s.orgId, channelAccountId: s.account.id, actorUserId: s.ownerId, changeType: "update_budget", title: "Raise budget", payload: { externalCampaignId: "c1", dailyBudgetMinor: 5000, currency: "CAD" } });
    const { fetchImpl, calls } = fakeFetch([{ match: () => true, respond: () => ({ json: { success: true } }) }]);
    await expect(executeAdChangeRequest(db, { organizationId: s.orgId, changeRequestId: proposed.id, deps: { fetchImpl, env: META_ENV } })).rejects.toBeInstanceOf(SocialAdChangeNotExecutableError);

    await db.update(socialAdChangeRequests).set({ status: "approved", approvedAt: new Date(), approvedByUserId: s.ownerId }).where(eq(socialAdChangeRequests.id, proposed.id));
    await expect(executeAdChangeRequest(db, { organizationId: s.orgId, changeRequestId: proposed.id, deps: { fetchImpl, env: META_ENV } })).rejects.toBeInstanceOf(SocialAdChangeNotExecutableError);
    const [row] = await db.select().from(socialAdChangeRequests).where(eq(socialAdChangeRequests.id, proposed.id));
    expect(row.status).toBe("failed");
    expect(row.lastErrorCode).toBe("ad_change_not_executable");
    expect(calls).toHaveLength(0);
  });

  it("reject and cancel paths; payload validation; non-ad accounts refused; cross-tenant 404", async () => {
    const s = await setup();
    const proposed = await proposeAdChange(db, { organizationId: s.orgId, channelAccountId: s.account.id, actorUserId: s.manager, changeType: "resume_campaign", title: "Resume", payload: { externalCampaignId: "c9" } });
    const submitted = await submitAdChangeForApproval(db, { organizationId: s.orgId, changeRequestId: proposed.id, actorUserId: s.manager, expectedRevision: proposed.revision });
    const rejected = await decideAdChange(db, { organizationId: s.orgId, changeRequestId: proposed.id, actorUserId: s.ownerId, expectedRevision: submitted.revision, decision: "reject", note: "Not now" });
    expect(rejected.status).toBe("rejected");
    const [approval] = await db.select().from(agentApprovalRequests).where(eq(agentApprovalRequests.id, submitted.approvalRequestId!));
    expect(approval.status).toBe("rejected");
    expect(await db.select().from(runtimeJobs).where(and(eq(runtimeJobs.organizationId, s.orgId), eq(runtimeJobs.idempotencyKey, `social_ad_change_execute:${proposed.id}`)))).toHaveLength(0);

    const another = await proposeAdChange(db, { organizationId: s.orgId, channelAccountId: s.account.id, actorUserId: s.manager, changeType: "pause_campaign", title: "Pause", payload: { externalCampaignId: "c2" } });
    const cancelled = await cancelAdChange(db, { organizationId: s.orgId, changeRequestId: another.id, actorUserId: s.manager, expectedRevision: another.revision });
    expect(cancelled.status).toBe("cancelled");

    await expect(proposeAdChange(db, { organizationId: s.orgId, channelAccountId: s.account.id, actorUserId: s.manager, changeType: "update_budget", title: "Bad", payload: { externalCampaignId: "c1", currency: "CAD" } })).rejects.toThrow();
    const organic = await makeManualAccount(s.orgId, s.brand.id, "instagram");
    await expect(proposeAdChange(db, { organizationId: s.orgId, channelAccountId: organic.id, actorUserId: s.manager, changeType: "pause_campaign", title: "x", payload: { externalCampaignId: "c1" } })).rejects.toBeInstanceOf(SocialAdChangeNotExecutableError);

    const contributor = await makeMarketingUser(s.orgId, "marketing_contributor", s.ownerId);
    await expect(proposeAdChange(db, { organizationId: s.orgId, channelAccountId: s.account.id, actorUserId: contributor, changeType: "pause_campaign", title: "x", payload: { externalCampaignId: "c1" } })).rejects.toBeInstanceOf(InsufficientRoleError);

    const other = await makeSocialOrg();
    await expect(submitAdChangeForApproval(db, { organizationId: other.orgId, changeRequestId: another.id, actorUserId: other.ownerId, expectedRevision: 1 })).rejects.toBeInstanceOf(TenantResourceNotFoundError);
    await expect(executeAdChangeRequest(db, { organizationId: other.orgId, changeRequestId: another.id })).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });
});
