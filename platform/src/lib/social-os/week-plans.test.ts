import { describe, it, expect } from "vitest";
import { WEEK_PLANS, currentWeekPlan, planInstant, planMarker } from "./week-plans";
import { SOCIAL_PLATFORM_RULES, socialContentBriefSchema } from "./validation";

const plan = WEEK_PLANS[0];

describe("week plan Oct 12", () => {
  it("has a feed post every day of the week for each brand", () => {
    for (const brand of ["lynq", "codeit"]) {
      const days = new Set(plan.feed.filter((p) => p.brand.brandKey === brand).map((p) => p.day));
      for (let i = 0; i < 7; i++) expect(days.has(`2026-10-${12 + i}`)).toBe(true);
    }
  });

  it("has three reels per brand, kept to the week", () => {
    for (const brand of ["lynq", "codeit"]) {
      const reels = plan.reels.filter((r) => r.brand.brandKey === brand);
      expect(reels).toHaveLength(3);
      for (const r of reels) expect(r.day >= "2026-10-12" && r.day <= "2026-10-18").toBe(true);
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
    expect(currentWeekPlan(new Date("2026-10-05T12:00:00Z"))?.key).toBe("2026-10-12");
    expect(currentWeekPlan(new Date("2026-10-18T12:00:00Z"))?.key).toBe("2026-10-12");
    expect(currentWeekPlan(new Date("2026-10-19T12:00:00Z"))).toBeUndefined();
  });

  it("story highlights use the plan's fixed highlight sets", () => {
    for (const p of plan.feed) {
      if (!p.storyHighlight) continue;
      const set = p.brand.brandKey === "codeit" ? plan.highlights.CodeIt : plan.highlights.LYNQ;
      expect(set).toContain(p.storyHighlight);
    }
  });

  it("proof and founder posts always use real screenshots or photos, never AI images", () => {
    for (const p of plan.feed) if (p.pillar === "PROOF" || p.pillar === "FOUNDER") expect(p.realPhotoOnly).toBe(true);
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
    expect(plan.linkedin.filter((l) => l.brand.brandKey === "lynq")).toHaveLength(2);
    expect(plan.linkedin.filter((l) => l.brand.brandKey === "codeit")).toHaveLength(2);
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
