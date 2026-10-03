import { describe, it, expect } from "vitest";
import { computeVariantWarnings, defaultFormatFor, normalizeHashtags, parseVariantChanges, scheduleWarning, type WarningVariantInput, type WarningAccount } from "./content";

const NOW = new Date("2026-10-01T12:00:00Z");

function variant(overrides: Partial<WarningVariantInput> = {}): WarningVariantInput {
  return { platform: "facebook", format: "text", status: "draft", hook: "", body: "Hello world", hashtags: [], callToAction: "", linkUrl: null, media: [], scheduledFor: null, channelAccountId: "acc-1", ...overrides };
}

function account(overrides: Partial<WarningAccount> = {}): WarningAccount {
  return { id: "acc-1", platform: "facebook", brandProfileId: "brand-1", displayName: "Lynq Page", connectionStatus: "connected", tokenExpiresAt: new Date(NOW.getTime() + 60 * 86400_000), archivedAt: null, ...overrides };
}

const codes = (w: { code: string }[]) => w.map((x) => x.code);
const jpeg = { id: "a1", title: "Photo", contentType: "image/jpeg", assetType: "image", archivedAt: null };
const png = { id: "a2", title: "Graphic", contentType: "image/png", assetType: "image", archivedAt: null };

describe("computeVariantWarnings", () => {
  it("is clean for a valid connected text post", () => {
    expect(computeVariantWarnings({ variant: variant(), account: account(), assets: [], brand: null, now: NOW })).toEqual([]);
  });

  it("blocks a caption over the platform limit and warns on too many hashtags", () => {
    const w = computeVariantWarnings({ variant: variant({ platform: "x", body: "a".repeat(281), hashtags: ["#a", "#b", "#c", "#d", "#e", "#f"] }), account: account({ platform: "x" }), assets: [], brand: null, now: NOW });
    expect(w.find((x) => x.code === "body_too_long")?.severity).toBe("blocking");
    expect(w.find((x) => x.code === "too_many_hashtags")?.severity).toBe("warning");
  });

  it("blocks a media format without media and an empty text post", () => {
    expect(codes(computeVariantWarnings({ variant: variant({ format: "image" }), account: account(), assets: [], brand: null, now: NOW }))).toContain("media_required");
    expect(codes(computeVariantWarnings({ variant: variant({ body: "  " }), account: account(), assets: [], brand: null, now: NOW }))).toContain("empty_body");
  });

  it("requires JPEG on Instagram", () => {
    const w = computeVariantWarnings({ variant: variant({ platform: "instagram", format: "image", media: [{ assetId: "a2", position: 0, role: "primary" }] }), account: account({ platform: "instagram" }), assets: [png], brand: null, now: NOW });
    expect(w.find((x) => x.code === "instagram_requires_jpeg")?.severity).toBe("blocking");
    const ok = computeVariantWarnings({ variant: variant({ platform: "instagram", format: "image", media: [{ assetId: "a1", position: 0, role: "primary" }] }), account: account({ platform: "instagram" }), assets: [jpeg], brand: null, now: NOW });
    expect(ok).toEqual([]);
  });

  it("blocks carousels over the item limit and missing assets", () => {
    const media = Array.from({ length: 11 }, (_, i) => ({ assetId: "a1", position: i, role: "carousel_item" as const }));
    expect(codes(computeVariantWarnings({ variant: variant({ format: "carousel", media }), account: account(), assets: [jpeg], brand: null, now: NOW }))).toContain("carousel_too_many_items");
    expect(codes(computeVariantWarnings({ variant: variant({ format: "image", media: [{ assetId: "gone", position: 0, role: "primary" }] }), account: account(), assets: [], brand: null, now: NOW }))).toContain("asset_missing");
  });

  it("blocks with no account or a disconnected account; warns on expiring tokens", () => {
    expect(codes(computeVariantWarnings({ variant: variant({ channelAccountId: null }), account: null, assets: [], brand: null, now: NOW }))).toContain("no_account");
    const nc = computeVariantWarnings({ variant: variant(), account: account({ connectionStatus: "token_expired" }), assets: [], brand: null, now: NOW });
    expect(nc.find((x) => x.code === "account_not_connected")?.message).toContain("token_expired");
    const soon = computeVariantWarnings({ variant: variant(), account: account({ tokenExpiresAt: new Date(NOW.getTime() + 2 * 86400_000) }), assets: [], brand: null, now: NOW });
    expect(soon.find((x) => x.code === "token_expiring")?.severity).toBe("warning");
    expect(codes(computeVariantWarnings({ variant: variant(), account: account({ platform: "linkedin" }), assets: [], brand: null, now: NOW }))).toContain("account_platform_mismatch");
  });

  it("blocks past schedules and schedules outside the platform window, but not once scheduled", () => {
    expect(codes(computeVariantWarnings({ variant: variant({ scheduledFor: new Date(NOW.getTime() - 60_000) }), account: account(), assets: [], brand: null, now: NOW }))).toContain("schedule_in_past");
    expect(codes(computeVariantWarnings({ variant: variant({ scheduledFor: new Date(NOW.getTime() + 5 * 60_000) }), account: account(), assets: [], brand: null, now: NOW }))).toContain("schedule_too_soon");
    expect(codes(computeVariantWarnings({ variant: variant({ scheduledFor: new Date(NOW.getTime() + 40 * 86400_000) }), account: account(), assets: [], brand: null, now: NOW }))).toContain("schedule_too_far");
    expect(computeVariantWarnings({ variant: variant({ status: "scheduled", scheduledFor: new Date(NOW.getTime() - 60_000) }), account: account(), assets: [], brand: null, now: NOW })).toEqual([]);
  });

  it("flags brand prohibited language and never-claim phrases (whole words, case-insensitive)", () => {
    const brand = { prohibitedLanguage: ["guaranteed"], neverClaim: ["number one in Canada"] };
    const w = computeVariantWarnings({ variant: variant({ body: "GUARANTEED results — we are Number One in Canada." }), account: account(), assets: [], brand, now: NOW });
    expect(w.find((x) => x.code === "prohibited_language")?.message).toContain('"guaranteed"');
    expect(w.find((x) => x.code === "never_claim")?.severity).toBe("warning");
    expect(codes(computeVariantWarnings({ variant: variant({ body: "unguaranteedly fine" }), account: account(), assets: [], brand, now: NOW }))).not.toContain("prohibited_language");
  });

  it("requires a link for link posts and flags unsupported formats", () => {
    expect(codes(computeVariantWarnings({ variant: variant({ format: "link" }), account: account(), assets: [], brand: null, now: NOW }))).toContain("link_required");
    expect(codes(computeVariantWarnings({ variant: variant({ platform: "instagram", format: "text" }), account: account({ platform: "instagram" }), assets: [], brand: null, now: NOW }))).toContain("format_not_supported");
  });
});

describe("format and hashtag helpers", () => {
  it("maps brief kinds to platform formats", () => {
    expect(defaultFormatFor("carousel", "instagram")).toBe("carousel");
    expect(defaultFormatFor("short_video_concept", "instagram")).toBe("reel");
    expect(defaultFormatFor("short_video_concept", "tiktok")).toBe("short_video");
    expect(defaultFormatFor("generated_video", "facebook")).toBe("video");
    expect(defaultFormatFor("video_script", "linkedin")).toBe("video");
    expect(defaultFormatFor("text_post", "linkedin")).toBe("text");
    // Instagram has no text format — falls back to its first supported one.
    expect(defaultFormatFor("text_post", "instagram")).toBe("image");
  });

  it("normalizes and dedupes hashtags", () => {
    expect(normalizeHashtags(["lynq", "#Lynq", "##web", " ", "Toronto"])).toEqual(["#lynq", "#web", "#Toronto"]);
  });

  it("scheduleWarning respects the per-platform window", () => {
    expect(scheduleWarning("instagram", new Date(NOW.getTime() + 2 * 60_000), NOW)).toBeNull();
    expect(scheduleWarning("facebook", new Date(NOW.getTime() + 2 * 60_000), NOW)?.code).toBe("schedule_too_soon");
  });
});

describe("parseVariantChanges", () => {
  it("keeps only the keys that were sent (no schema defaults leak into a PATCH)", () => {
    expect(parseVariantChanges({ body: "New body" })).toEqual({ body: "New body" });
    expect(parseVariantChanges({ hashtags: ["a"], scheduledFor: null })).toEqual({ hashtags: ["a"], scheduledFor: null });
  });
  it("still rejects unknown keys and invalid values", () => {
    expect(() => parseVariantChanges({ platform: "x" })).toThrow();
    expect(() => parseVariantChanges({ format: "hologram" })).toThrow();
  });
});
