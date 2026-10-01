import { describe, it, expect, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { runtimeJobs, socialPublishJobs } from "@/db/schema";
import { InsufficientRoleError } from "@/lib/authz/errors";
import { db, makeSocialOrg, makeSocialBrand, makeConnectedAccount, makeMarketingUser, cleanupAgentRuntimeTestData } from "./test-helpers";
import { createContentItem, updateVariant, submitVariantForReview, decideVariantApproval } from "./content";
import { getSocialCalendar, rescheduleVariant } from "./calendar";
import { InvalidSocialTransitionError, SocialInvalidScheduleError } from "./errors";
import { socialContentBriefSchema } from "./validation";

const DAY = 24 * 3600_000;

function utcDay(offsetDays: number, hour = 15): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays, hour, 0, 0));
}

async function setup() {
  const { orgId, ownerId } = await makeSocialOrg();
  const brand = await makeSocialBrand(orgId, ownerId, { preferredPlatforms: ["facebook"] });
  await makeConnectedAccount(orgId, brand.id, "facebook");
  const brief = socialContentBriefSchema.parse({ topic: "Calendar" });

  // A scheduled post (approved + queued) two days out.
  const scheduled = await createContentItem(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, title: "Scheduled", brief, platforms: ["facebook"] });
  let v = await updateVariant(db, { organizationId: orgId, contentVariantId: scheduled.variants[0].id, actorUserId: ownerId, expectedRevision: scheduled.variants[0].revision, changes: { body: "Scheduled post" } });
  v = await submitVariantForReview(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: v.revision });
  v = await decideVariantApproval(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: v.revision, decision: "approve", scheduledFor: utcDay(2) });

  // A draft planned (item-level date) for day 3, and an undated idea.
  const planned = await createContentItem(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, title: "Planned", brief, platforms: ["facebook"], scheduledFor: utcDay(3) });
  const idea = await createContentItem(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, title: "Idea", brief, platforms: ["facebook"] });
  return { orgId, ownerId, brand, scheduledVariant: v, planned, idea };
}

describe("Social calendar (integration)", () => {
  afterEach(cleanupAgentRuntimeTestData);

  it("places dated posts on the grid, lists undated ideas, and reports gaps on preferred platforms", async () => {
    const s = await setup();
    const cal = await getSocialCalendar(db, { organizationId: s.orgId, actorUserId: s.ownerId, from: utcDay(0, 0), to: utcDay(7, 0), brandProfileId: s.brand.id, view: "week" });

    const byTitle = Object.fromEntries(cal.entries.map((e) => [e.title, e]));
    expect(Object.keys(byTitle).sort()).toEqual(["Planned", "Scheduled"]);
    expect(byTitle.Scheduled).toMatchObject({ status: "scheduled", platform: "facebook", blocking: false, brandName: s.brand.name });
    expect(byTitle.Scheduled.date).toBe(utcDay(2).toISOString());
    expect(byTitle.Planned.status).toBe("idea"); // empty draft
    expect(byTitle.Planned.date).toBe(utcDay(3).toISOString());
    expect(cal.undated.map((e) => e.title)).toEqual(["Idea"]);
    expect(cal.countsByStatus.scheduled).toBe(1);
    expect(cal.countsByStatus.idea).toBe(2);

    const gapDays = cal.gaps.filter((g) => g.platform === "facebook").map((g) => g.date);
    const d = (n: number) => utcDay(n).toISOString().slice(0, 10);
    expect(gapDays).not.toContain(d(2)); // filled by the scheduled post
    expect(gapDays).toContain(d(3)); // a draft does not fill a day
    expect(gapDays).toContain(d(1));
    expect(cal.gaps.every((g) => g.platform === "facebook")).toBe(true);

    await expect(getSocialCalendar(db, { organizationId: s.orgId, actorUserId: s.ownerId, from: utcDay(0), to: utcDay(200), view: "month" })).rejects.toBeInstanceOf(SocialInvalidScheduleError);
  });

  it("computes gap days in the caller's timezone, so an evening post fills the day the grid shows it on", async () => {
    const s = await setup();
    // 01:00 UTC on day 4 is 9 p.m. (EDT) / 8 p.m. (EST) on day 3 in Toronto.
    await rescheduleVariant(db, { organizationId: s.orgId, contentVariantId: s.scheduledVariant.id, actorUserId: s.ownerId, expectedRevision: s.scheduledVariant.revision, scheduledFor: utcDay(4, 1) });
    const d = (n: number) => utcDay(n).toISOString().slice(0, 10);
    const range = { organizationId: s.orgId, actorUserId: s.ownerId, from: utcDay(0, 0), to: utcDay(7, 0), brandProfileId: s.brand.id, view: "week" as const };
    const utc = (await getSocialCalendar(db, range)).gaps.map((g) => g.date);
    expect(utc).not.toContain(d(4));
    expect(utc).toContain(d(3));
    const toronto = (await getSocialCalendar(db, { ...range, timeZone: "America/Toronto" })).gaps.map((g) => g.date);
    expect(toronto).not.toContain(d(3));
    expect(toronto).toContain(d(4));
  });

  it("rescheduling a scheduled post cancels its job and queues a new one for the new time", async () => {
    const s = await setup();
    const [oldJob] = await db.select().from(socialPublishJobs).where(eq(socialPublishJobs.contentVariantId, s.scheduledVariant.id));
    expect(oldJob.status).toBe("queued");

    const newTime = utcDay(5, 9);
    const moved = await rescheduleVariant(db, { organizationId: s.orgId, contentVariantId: s.scheduledVariant.id, actorUserId: s.ownerId, expectedRevision: s.scheduledVariant.revision, scheduledFor: newTime });
    expect(moved.status).toBe("scheduled");
    expect(moved.scheduledFor?.getTime()).toBe(newTime.getTime());

    const jobs = await db.select().from(socialPublishJobs).where(eq(socialPublishJobs.contentVariantId, s.scheduledVariant.id));
    const cancelled = jobs.find((j) => j.id === oldJob.id)!;
    const active = jobs.find((j) => j.status === "queued")!;
    expect(cancelled.status).toBe("cancelled");
    expect(active.id).not.toBe(oldJob.id);
    expect(active.scheduledFor.getTime()).toBe(newTime.getTime());
    const [oldRuntime] = await db.select().from(runtimeJobs).where(eq(runtimeJobs.id, oldJob.runtimeJobId!));
    expect(oldRuntime.status).toBe("cancelled");
    const [newRuntime] = await db.select().from(runtimeJobs).where(and(eq(runtimeJobs.id, active.runtimeJobId!), eq(runtimeJobs.organizationId, s.orgId)));
    expect(newRuntime.status).toBe("queued");
    expect(newRuntime.availableAt.getTime()).toBe(newTime.getTime());

    // A draft just moves; a past time is refused; a contributor cannot move a scheduled post.
    const draft = s.planned.variants[0];
    const movedDraft = await rescheduleVariant(db, { organizationId: s.orgId, contentVariantId: draft.id, actorUserId: s.ownerId, expectedRevision: draft.revision, scheduledFor: utcDay(4) });
    expect(movedDraft).toMatchObject({ status: "draft" });
    expect(movedDraft.scheduledFor?.getTime()).toBe(utcDay(4).getTime());
    await expect(rescheduleVariant(db, { organizationId: s.orgId, contentVariantId: draft.id, actorUserId: s.ownerId, expectedRevision: movedDraft.revision, scheduledFor: new Date(Date.now() - DAY) })).rejects.toBeInstanceOf(SocialInvalidScheduleError);
    const contributor = await makeMarketingUser(s.orgId, "marketing_contributor", s.ownerId);
    await expect(rescheduleVariant(db, { organizationId: s.orgId, contentVariantId: moved.id, actorUserId: contributor, expectedRevision: moved.revision, scheduledFor: utcDay(6) })).rejects.toBeInstanceOf(InsufficientRoleError);
  });

  it("refuses to move a published post", async () => {
    const s = await setup();
    const { socialContentVariants } = await import("@/db/schema");
    await db.update(socialContentVariants).set({ status: "published", publishedAt: new Date() }).where(eq(socialContentVariants.id, s.scheduledVariant.id));
    await expect(rescheduleVariant(db, { organizationId: s.orgId, contentVariantId: s.scheduledVariant.id, actorUserId: s.ownerId, expectedRevision: s.scheduledVariant.revision, scheduledFor: utcDay(4) })).rejects.toBeInstanceOf(InvalidSocialTransitionError);
  });
});
