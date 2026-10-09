import { describe, it, expect } from "vitest";
import { WEEK_PLANS, currentWeekPlan, planInstant, planMarker, planEnd } from "./week-plans";

const next = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
import { SOCIAL_PLATFORM_RULES, socialContentBriefSchema } from "./validation";

const plan = WEEK_PLANS[0];

describe("week plan Oct 12", () => {
  it("posts every day from the week start to the plan end: each brand has a feed post or a reel every single day", () => {
    for (const brand of ["lynq", "codeit"]) {
      const covered = new Set([...plan.feed.filter((p) => p.brand.brandKey === brand), ...plan.reels.filter((r) => r.brand.brandKey === brand)].map((e) => e.day));
      for (let d = plan.weekStart; d <= planEnd(plan); d = next(d)) expect(covered.has(d), `${brand} ${d}`).toBe(true);
    }
    for (const brand of ["lynq", "codeit"]) {
      const days = new Set(plan.feed.filter((p) => p.brand.brandKey === brand).map((p) => p.day));
      expect(days.size, brand).toBeGreaterThanOrEqual(7);
      for (const d of days) expect(d >= plan.weekStart && d <= planEnd(plan), `${brand} ${d}`).toBe(true);
    }
  });

  it("has at least three reels per brand, kept to the plan", () => {
    for (const brand of ["lynq", "codeit"]) {
      const reels = plan.reels.filter((r) => r.brand.brandKey === brand);
      expect(reels.length).toBeGreaterThanOrEqual(3);
      for (const r of reels) expect(r.day >= plan.weekStart && r.day <= planEnd(plan)).toBe(true);
    }
  });

  it("keeps the grid rule: any three consecutive feed posts of a brand never repeat a pillar", () => {
    for (const brand of ["lynq", "codeit"]) {
      const posts = plan.feed.filter((p) => p.brand.brandKey === brand).sort((a, b) => `${a.day}${a.time}`.localeCompare(`${b.day}${b.time}`));
      for (let i = 0; i + 2 < posts.length; i++) expect(new Set(posts.slice(i, i + 3).map((p) => p.pillar)).size).toBe(3);
    }
  });

  it("every caption fits Instagram's limits and every hashtag is valid", () => {
    const rules = SOCIAL_PLATFORM_RULES.instagram;
    for (const e of [...plan.feed, ...plan.reels]) {
      if (!("body" in e) || !e.body) continue;
      expect(e.body.length).toBeLessThanOrEqual(rules.maxBodyLength);
      expect((e.hashtags ?? []).length).toBeLessThanOrEqual(rules.maxHashtags);
      for (const t of e.hashtags ?? []) expect(t).toMatch(/^#?[\p{L}\p{N}_]{1,100}$/u);
    }
  });

  it("CodeIt copy only quotes CAD and never claims Mustafa is a parent", () => {
    const text = plan.feed.concat().filter((p) => p.brand.brandKey === "codeit").map((p) => `${p.body} ${p.hook}`).join(" ") + plan.reels.filter((r) => r.brand.brandKey === "codeit").map((r) => r.body).join(" ");
    expect(text).not.toMatch(/USD|US\$|\$12(?!\/)/);
    expect(text).toMatch(/CA\$12/);
    expect(text).not.toMatch(/\b(my kids?|as a parent|i'm a parent|homeschool)\b/i);
  });

  it("reel shots and briefs are valid against the brief schema", () => {
    for (const r of plan.reels) {
      const brief = socialContentBriefSchema.safeParse({ kind: "short_video_concept", hook: r.hook, script: r.script, shots: r.shots.map((s) => ({ ...s, onScreenText: s.onScreenText ?? "", audio: s.audio ?? "" })), researchNotes: planMarker(plan.key, r.key) });
      expect(brief.success).toBe(true);
    }
  });

  it("times are Toronto local (EDT in October)", () => {
    expect(planInstant("2026-10-12", "12:15").toISOString()).toBe("2026-10-12T16:15:00.000Z");
    expect(planInstant("2026-10-12", "12:15", 10).toISOString()).toBe("2026-10-12T16:25:00.000Z");
  });

  it("is the current plan until the week ends", () => {
    expect(currentWeekPlan(new Date("2026-10-06T12:00:00Z"))?.key).toBe("2026-10-12");
    expect(currentWeekPlan(new Date("2026-10-21T12:00:00Z"))?.key).toBe("2026-10-12");
    expect(currentWeekPlan(new Date("2026-10-22T12:00:00Z"))).toBeUndefined();
  });

  it("story highlights use the plan's fixed highlight sets", () => {
    for (const p of plan.feed) {
      if (!p.storyHighlight) continue;
      const set = p.brand.brandKey === "codeit" ? plan.highlights.CodeIt : plan.highlights.LYNQ;
      expect(set).toContain(p.storyHighlight);
    }
  });

  it("needs no uploads, and proof/founder art never fakes a client's site or a real person", () => {
    for (const p of plan.feed) {
      expect(p.realPhotoOnly, p.key).toBeFalsy();
      expect(p.body, p.key).not.toMatch(/swipe/i);
      if (p.pillar !== "PROOF" && p.pillar !== "FOUNDER") continue;
      expect(p.creativeDirection, p.key).not.toMatch(/screenshot|real photo|upload/i);
      expect(p.creativeDirection, p.key).toMatch(/no website screens|no real people/i);
    }
  });

  it("captions read like a person wrote them: no dashes, arrows or markers", () => {
    const texts: [string, string][] = [];
    for (const p of plan.feed) texts.push([p.key, p.hook ?? ""], [p.key, p.body ?? ""], [p.key, p.facebookBody ?? ""], [p.key, p.fallback?.body ?? ""], [p.key, p.fallback?.facebookBody ?? ""]);
    for (const r of plan.reels) texts.push([r.key, r.hook], [r.key, r.body], [r.key, r.facebookBody ?? ""]);
    for (const li of plan.linkedin) texts.push([li.key, li.body]);
    for (const [key, t] of texts) {
      expect(t, key).not.toMatch(/[—–▸→]/);
      expect(t, key).not.toMatch(/ - /);
    }
  });

  it("Facebook captions are their own shorter version, and hashtags stay at five or fewer", () => {
    for (const e of [...plan.feed, ...plan.reels]) {
      expect(e.facebookBody, e.key).toBeTruthy();
      expect(e.facebookBody!.length, e.key).toBeLessThan(e.body!.length);
      expect((e.hashtags ?? []).length, e.key).toBeLessThanOrEqual(5);
      expect(e.facebookBody, e.key).not.toMatch(/#\w/);
    }
  });

  it("LinkedIn posts are text-only founder posts of roughly 800–1,000+ characters with no links", () => {
    expect(plan.linkedin.filter((l) => l.brand.brandKey === "lynq").length).toBeGreaterThanOrEqual(2);
    expect(plan.linkedin.filter((l) => l.brand.brandKey === "codeit").length).toBeGreaterThanOrEqual(2);
    for (const l of plan.linkedin) {
      expect(l.body.length, l.key).toBeGreaterThan(700);
      expect(l.body.length, l.key).toBeLessThan(1500);
      expect(l.body, l.key).not.toMatch(/https?:\/\/|www\./);
    }
  });

  it("reel hooks are short enough to land in the first three seconds", () => {
    for (const r of plan.reels) expect(r.hook.length, r.key).toBeLessThanOrEqual(90);
  });
});

describe("catch-up for slots already in the past", () => {
  it("keeps a future slot, moves a past one to the next quarter-hour at least 20 minutes out", async () => {
    const { catchUp } = await import("./week-plans");
    const now = new Date("2026-10-09T17:12:00Z");
    expect(catchUp(new Date("2026-10-09T18:00:00Z"), now).toISOString()).toBe("2026-10-09T18:00:00.000Z");
    expect(catchUp(new Date("2026-10-07T23:30:00Z"), now).toISOString()).toBe("2026-10-09T17:45:00.000Z");
    expect(catchUp(new Date("2026-10-09T17:20:00Z"), now).toISOString()).toBe("2026-10-09T17:45:00.000Z");
  });
});
