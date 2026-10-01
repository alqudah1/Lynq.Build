import { describe, it, expect } from "vitest";
import { attentionActions, buildSocialAttentionItems, greetingFor, localDayBounds, toFounderAttentionItems, type SocialAttentionFacts } from "./attention";

const now = new Date("2026-10-01T14:00:00Z"); // 10:00 in Toronto (EDT)

function facts(overrides: Partial<SocialAttentionFacts> = {}): SocialAttentionFacts {
  return {
    organizationId: "org-1",
    reviewQueue: { count: 0, oldestAt: null },
    scheduledToday: 0,
    publishedToday: 0,
    failedPublishJobs: { count: 0, latestAt: null },
    inbox: { openCount: 0, newCount: 0, oldestAt: null },
    brokenAccounts: [],
    expiringAccounts: [],
    stalePlatforms: [],
    adAnomalies: [],
    brandsWithoutUpcoming: [],
    engagementTrend: null,
    aiBudget: null,
    ...overrides,
  };
}

describe("greeting + local day (America/Toronto)", () => {
  it("greets by Toronto local hour", () => {
    expect(greetingFor(new Date("2026-10-01T12:30:00Z"))).toBe("Good morning"); // 08:30
    expect(greetingFor(new Date("2026-10-01T17:00:00Z"))).toBe("Good afternoon"); // 13:00
    expect(greetingFor(new Date("2026-10-01T23:00:00Z"))).toBe("Good evening"); // 19:00
    expect(greetingFor(new Date("2026-10-02T03:30:00Z"))).toBe("Good evening"); // 23:30 previous day
    expect(greetingFor(new Date("2026-01-15T16:59:00Z"))).toBe("Good morning"); // 11:59 EST
  });

  it("computes the Toronto day bounds in UTC", () => {
    const { start, end } = localDayBounds(now);
    expect(start.toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-02T04:00:00.000Z");
  });
});

describe("attention rule severity", () => {
  it("is empty when nothing needs attention", () => {
    expect(buildSocialAttentionItems(facts(), now)).toEqual([]);
  });

  it("escalates old approvals and old unanswered comments to urgent", () => {
    const fresh = buildSocialAttentionItems(facts({ reviewQueue: { count: 2, oldestAt: new Date(now.getTime() - 2 * 3600_000) }, inbox: { openCount: 3, newCount: 3, oldestAt: new Date(now.getTime() - 3600_000) } }), now);
    expect(fresh.find((i) => i.id === "social_review_queue")?.severity).toBe("attention");
    expect(fresh.find((i) => i.id === "social_inbox_open")?.severity).toBe("attention");
    const stale = buildSocialAttentionItems(facts({ reviewQueue: { count: 2, oldestAt: new Date(now.getTime() - 30 * 3600_000) }, inbox: { openCount: 3, newCount: 1, oldestAt: new Date(now.getTime() - 50 * 3600_000) } }), now);
    expect(stale.find((i) => i.id === "social_review_queue")?.severity).toBe("urgent");
    expect(stale.find((i) => i.id === "social_inbox_open")?.severity).toBe("urgent");
  });

  it("marks broken connections and failed publishes urgent, sorted first", () => {
    const items = buildSocialAttentionItems(
      facts({
        scheduledToday: 2,
        failedPublishJobs: { count: 1, latestAt: now },
        brokenAccounts: [{ id: "acc-1", displayName: "LYNQ", platform: "instagram", status: "token_expired", lastErrorMessage: null }],
      }),
      now,
    );
    expect(items[0].severity).toBe("urgent");
    expect(items.map((i) => i.reasonCode)).toEqual(["social_publish_failed", "social_account_reauthorize", "social_scheduled_today"]);
    expect(items.find((i) => i.reasonCode === "social_account_reauthorize")).toMatchObject({ path: "/social/connections", recordType: "marketing_channel_account", recordId: "acc-1" });
  });

  it("flags quiet platforms at the threshold and brands with nothing planned", () => {
    const items = buildSocialAttentionItems(
      facts({
        stalePlatforms: [
          { accountId: "a", displayName: "LYNQ", platform: "linkedin", daysSinceLastPost: 3 },
          { accountId: "b", displayName: "CodeIt", platform: "instagram", daysSinceLastPost: 4 },
          { accountId: "c", displayName: "New", platform: "facebook", daysSinceLastPost: null },
        ],
        brandsWithoutUpcoming: [{ id: "brand-2", name: "CodeItLearn" }],
      }),
      now,
    );
    expect(items.filter((i) => i.reasonCode === "social_platform_quiet").map((i) => [i.recordId, i.severity])).toEqual([
      ["b", "attention"],
      ["c", "info"],
    ]);
    expect(items.find((i) => i.reasonCode === "social_brand_needs_content")?.title).toBe("CodeItLearn needs another post");
  });

  it("grades ad anomalies and AI budget", () => {
    const items = buildSocialAttentionItems(
      facts({
        adAnomalies: [
          { campaignId: "c1", channelAccountId: "ads", name: "Promo", kind: "spend_spike", detail: "x" },
          { campaignId: "c2", channelAccountId: "ads", name: "Brand", kind: "ctr_drop", detail: "y" },
        ],
        aiBudget: { spentUsd: 21, budgetUsd: 25 },
      }),
      now,
    );
    expect(items.find((i) => i.reasonCode === "social_ad_spend_spike")?.severity).toBe("urgent");
    expect(items.find((i) => i.reasonCode === "social_ad_ctr_drop")?.severity).toBe("attention");
    expect(items.find((i) => i.reasonCode === "social_ai_budget")?.severity).toBe("attention");
  });

  it("derives deduped actions and the founder-OS shape", () => {
    const items = buildSocialAttentionItems(facts({ reviewQueue: { count: 1, oldestAt: now }, inbox: { openCount: 1, newCount: 1, oldestAt: now } }), now);
    expect(attentionActions(items)).toEqual([
      { label: "Review posts", path: "/social/approvals" },
      { label: "Open inbox", path: "/social/inbox" },
    ]);
    const founder = toFounderAttentionItems(items);
    expect(founder[0]).toMatchObject({ domain: "marketing", recordType: "organization", recordId: "org-1", dueAt: null, recommendedActionType: "review_posts" });
  });
});
