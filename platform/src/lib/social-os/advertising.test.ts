import { describe, it, expect } from "vitest";
import { computeAdAnomalies, computeAdTotals, deriveAdMetrics, latestPerCampaign, normalizeAdRecommendations, type AdSnapshotLike } from "./advertising";

const D = (iso: string) => new Date(iso);

function snap(overrides: Partial<AdSnapshotLike>): AdSnapshotLike {
  return {
    channelAccountId: "acct",
    externalCampaignId: "c1",
    name: "Spring promo",
    status: "ACTIVE",
    dailyBudgetMinor: null,
    lifetimeBudgetMinor: null,
    periodStart: D("2026-09-01T00:00:00Z"),
    periodEnd: D("2026-09-11T00:00:00Z"),
    capturedAt: D("2026-09-11T01:00:00Z"),
    spendMinor: 10000,
    impressions: 20000,
    clicks: 400,
    ...overrides,
  };
}

describe("derived ad metrics", () => {
  it("is null-safe and never divides by zero", () => {
    expect(deriveAdMetrics({ spendMinor: null, impressions: 1000, clicks: 10, conversions: null })).toEqual({ cpc: null, cpm: null, ctr: 0.01, cpa: null });
    expect(deriveAdMetrics({ spendMinor: 5000, impressions: 0, clicks: 0, conversions: 0 })).toEqual({ cpc: null, cpm: null, ctr: null, cpa: null });
    expect(deriveAdMetrics({ spendMinor: 5000, impressions: 10000, clicks: 100, conversions: 5 })).toEqual({ cpc: 50, cpm: 500, ctr: 0.01, cpa: 1000 });
  });

  it("does not add money across currencies", () => {
    const t = computeAdTotals([
      { currency: "CAD", spendMinor: 100, impressions: 10, clicks: 1, reach: null, conversions: null },
      { currency: "USD", spendMinor: 200, impressions: 20, clicks: 1, reach: null, conversions: null },
    ]);
    expect(t.currency).toBeNull();
    expect(t.spendMinor).toBeNull();
    expect(t.impressions).toBe(30);
  });

  it("latestPerCampaign keeps the newest period per campaign", () => {
    const rows = [snap({ periodEnd: D("2026-09-10T00:00:00Z"), spendMinor: 1 }), snap({ periodEnd: D("2026-09-11T00:00:00Z"), spendMinor: 2 }), snap({ externalCampaignId: "c2", spendMinor: 3 })];
    expect(latestPerCampaign(rows).map((r) => r.spendMinor).sort()).toEqual([2, 3]);
  });
});

describe("computeAdAnomalies (deterministic)", () => {
  it("flags a spend spike between the last two periods", () => {
    const prev = snap({ periodStart: D("2026-08-22T00:00:00Z"), periodEnd: D("2026-09-01T00:00:00Z"), spendMinor: 10000 });
    const cur = snap({ spendMinor: 30000 });
    const kinds = computeAdAnomalies([prev, cur]).map((a) => a.kind);
    expect(kinds).toContain("spend_spike");
  });

  it("flags a CTR drop only with enough impressions in both periods", () => {
    const prev = snap({ periodStart: D("2026-08-22T00:00:00Z"), periodEnd: D("2026-09-01T00:00:00Z"), impressions: 20000, clicks: 400 });
    const cur = snap({ impressions: 20000, clicks: 100 });
    expect(computeAdAnomalies([prev, cur]).map((a) => a.kind)).toContain("ctr_drop");
    const thin = computeAdAnomalies([snap({ ...prev, impressions: 500, clicks: 10 }), snap({ impressions: 500, clicks: 1 })]);
    expect(thin.map((a) => a.kind)).not.toContain("ctr_drop");
  });

  it("flags zero impressions on an active campaign, never on a paused one or missing data", () => {
    expect(computeAdAnomalies([snap({ impressions: 0, clicks: 0, spendMinor: 0 })]).map((a) => a.kind)).toEqual(["zero_impressions"]);
    expect(computeAdAnomalies([snap({ status: "PAUSED", impressions: 0, clicks: 0, spendMinor: 0 })])).toEqual([]);
    expect(computeAdAnomalies([snap({ impressions: null, clicks: null, spendMinor: null })])).toEqual([]);
  });

  it("flags an exhausted lifetime budget", () => {
    const a = computeAdAnomalies([snap({ lifetimeBudgetMinor: 10000, spendMinor: 9990 })]);
    expect(a.map((x) => x.kind)).toEqual(["budget_exhausted"]);
  });

  it("is quiet for steady campaigns", () => {
    const prev = snap({ periodStart: D("2026-08-22T00:00:00Z"), periodEnd: D("2026-09-01T00:00:00Z") });
    expect(computeAdAnomalies([prev, snap({})])).toEqual([]);
  });
});

describe("normalizeAdRecommendations", () => {
  const known = new Set(["c1"]);

  it("drops unknown change types, invalid payloads and unknown campaigns", () => {
    const { valid, dropped } = normalizeAdRecommendations(
      [
        { title: "Pause the weak one", changeType: "pause_campaign", rationale: "CTR halved", payload: { externalCampaignId: "c1" } },
        { title: "Pause a ghost", changeType: "pause_campaign", rationale: "", payload: { externalCampaignId: "nope" } },
        { title: "Raise budget", changeType: "update_budget", rationale: "", payload: { externalCampaignId: "c1", currency: "CAD" } },
        { title: "Delete everything", changeType: "delete_account", rationale: "", payload: {} },
        { title: "Budget with bad type", changeType: "update_budget", rationale: "", payload: { externalCampaignId: "c1", dailyBudgetMinor: "lots", currency: "CAD" } },
        { title: "New test campaign", changeType: "create_campaign", rationale: "", payload: { name: "Test", objective: "OUTCOME_LEADS", dailyBudgetMinor: 2000, currency: "CAD" }, estimatedDailySpendMinor: 2000 },
        "not an object",
      ],
      { knownCampaignIds: known },
    );
    expect(valid.map((v) => v.title)).toEqual(["Pause the weak one", "New test campaign"]);
    expect(dropped).toBe(5);
    expect(valid[1]).toMatchObject({ changeType: "create_campaign", estimatedDailySpendMinor: 2000, externalCampaignId: null });
    expect(valid[1].payload.startPaused).toBe(true);
  });
});
