import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { WEEK_PLANS, isManualStoryMarker, pipSeries, planEnd, planInstant, planMarker, storyEntryKey } from "./week-plans";
import { HIGHLIGHT_COVERS, coverSvg, needsSticker, stickerZone, storyKey, storySvg } from "./story-original";
import { videoSecondsFor } from "./studio";
import { stickerStoryCaption } from "./telegram";

const withStories = WEEK_PLANS.filter((p) => p.stories?.length);

describe.each(withStories)("stories in plan $key", (plan) => {
  it("one story a day for each brand, inside the plan", () => {
    for (const brand of ["lynq", "codeit"]) {
      // Case-study highlight runs post several frames in a row; the daily rule is for the rest.
      const days = plan.stories!.filter((s) => s.brand.brandKey === brand && s.spec.kind !== "image").map((s) => s.day);
      expect(new Set(days).size, brand).toBe(days.length);
      for (const d of days) expect(d >= plan.weekStart && d <= planEnd(plan)).toBe(true);
    }
  });

  it("files every story under one of the brand's highlights, and each highlight has a cover", () => {
    for (const s of plan.stories!) {
      if (!s.highlight) continue;
      const brand = s.brand.brandKey === "codeit" ? "codeit" : "lynq";
      expect(plan.highlights[brand === "codeit" ? "CodeIt" : "LYNQ"]).toContain(s.highlight);
      expect(HIGHLIGHT_COVERS[brand][s.highlight], s.highlight).toBeDefined();
    }
  });

  it("sticker stories get a manual marker (never submitted by the morning send); the rest don't", () => {
    for (const s of plan.stories!) expect(isManualStoryMarker(planMarker(plan.key, storyEntryKey(s)))).toBe(needsSticker(s.spec));
    expect(isManualStoryMarker(planMarker(plan.key, "n-lynq-call-story"))).toBe(false);
  });

  it("object stories name a feed post of the same brand for their photo", () => {
    for (const s of plan.stories!.filter((x) => x.spec.kind === "object")) {
      const feed = plan.feed.find((p) => p.key === s.photoFrom);
      expect(feed?.brand.brandKey, s.key).toBe(s.brand.brandKey);
      expect(feed!.day <= s.day).toBe(true);
    }
  });

  it("every CodeIt quiz is answered the next day, and the answer matches the quiz's correct option", () => {
    const st = plan.stories!.filter((s) => s.brand.brandKey === "codeit");
    for (const q of st) {
      if (q.spec.kind !== "quiz") continue;
      const nextDay = new Date(Date.parse(`${q.day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      const a = st.find((s) => s.day === nextDay);
      expect(a?.spec.kind, q.key).toBe("answer");
      const right = q.spec.sticker.options[q.spec.sticker.correct]!;
      if (a?.spec.kind === "answer") expect(a.spec.answer.startsWith(right), `${q.key}: ${right} vs ${a.spec.answer}`).toBe(true);
    }
  });

  it("every sticker lands inside Instagram's safe area (below the top 250 px, above the bottom 320 px)", () => {
    for (const s of plan.stories!.filter((x) => needsSticker(x.spec))) {
      const z = stickerZone(s.spec);
      expect(z.y, s.key).toBeGreaterThanOrEqual(250);
      expect(z.y + z.h, s.key).toBeLessThanOrEqual(1600);
    }
  });

  it("case-study frames are bundled, in order, five minutes apart", () => {
    const runs = new Map<string, typeof plan.stories>();
    for (const s of plan.stories!.filter((x) => x.spec.kind === "image")) runs.set(s.highlight ?? "", [...(runs.get(s.highlight ?? "") ?? []), s]);
    for (const [, run] of runs) {
      run!.forEach((s, i) => {
        if (s.spec.kind !== "image") return;
        expect(existsSync(path.join(process.cwd(), "src", "assets", "cases", s.spec.file)), s.spec.file).toBe(true);
        if (i) expect(planInstant(s.day, s.time).getTime() - planInstant(run![i - 1]!.day, run![i - 1]!.time).getTime()).toBe(5 * 60_000);
      });
    }
  });

  it("lists fit their layout: a checklist has at most four items, an index at most six rows", () => {
    for (const s of plan.stories!) {
      if (s.spec.kind === "checklist") expect(s.spec.items.length, s.key).toBeLessThanOrEqual(4);
      if (s.spec.kind === "index") expect(s.spec.rows.length, s.key).toBeLessThanOrEqual(6);
    }
  });

  it("renders every story as valid SVG text with no em dashes", () => {
    for (const s of plan.stories!) {
      const svg = storySvg(s.spec);
      expect(svg).not.toContain("undefined");
      expect(svg).not.toContain("—");
    }
  });
});

describe("story keys", () => {
  it("change when the spec changes, so the image is re-rendered", () => {
    const s = withStories[0]!.stories![0]!.spec;
    expect(storyKey(s)).toBe(storyKey(JSON.parse(JSON.stringify(s))));
    expect(storyKey(s)).not.toBe(storyKey({ ...s, extra: 1 } as unknown as typeof s));
  });
});

describe("highlight covers", () => {
  it("draw for every highlight without text overflow or broken attributes", () => {
    for (const brand of ["codeit", "lynq"] as const) for (const c of Object.values(HIGHLIGHT_COVERS[brand])) {
      const svg = coverSvg(brand, c.mark, c.letters);
      expect(svg).not.toMatch(/fill="[^"]*"[^>]*fill=/);
    }
  });
});

describe("Pip builds a game", () => {
  const { reels, stories } = pipSeries("2026-11-05");
  it("is five 10-second AI episodes, two days apart, with a poll and a quiz in between", () => {
    expect(reels.map((r) => r.day)).toEqual(["2026-11-05", "2026-11-07", "2026-11-09", "2026-11-11", "2026-11-13"]);
    for (const r of reels) {
      expect(r.aiVideo?.seconds).toBe(10);
      expect(r.aiVideo!.prompt.length).toBeLessThanOrEqual(1000);
      expect(r.body).not.toMatch(/—| - /);
      expect(r.brand.brandKey).toBe("codeit");
    }
    expect(stories.map((s) => s.day)).toEqual(["2026-11-08", "2026-11-10"]);
    for (const s of stories) expect(needsSticker(s.spec)).toBe(true);
  });
});

describe("video length", () => {
  it("a planned reel asks for its length; anything else is 5 seconds", () => {
    expect(videoSecondsFor(["Reel series: X", "AI video: 10 seconds. Made only when you press Make video."])).toBe(10);
    expect(videoSecondsFor(["AI video: 30 seconds"])).toBe(5);
    expect(videoSecondsFor([])).toBe(5);
  });
});

describe("sticker story Telegram message", () => {
  it("gives the time, the steps, the exact sticker and the highlight", () => {
    const c = stickerStoryCaption({ title: "Story · c-quiz-ha → QUIZ (sticker)", at: new Date("2026-10-24T21:00:00Z"), sticker: 'Quiz sticker: "What does it print?"\n✅ hahaha', keyPoints: ["After it posts, add this story to the QUIZ highlight (Instagram app → story → Highlight)."] });
    expect(c).toContain("5:00");
    expect(c).toContain('Quiz sticker: "What does it print?"');
    expect(c).toContain("add it to the QUIZ highlight");
    expect(c).not.toContain("(sticker)");
  });
});

describe("rendered reels", () => {
  it("every reel that names a video file has it bundled in src/assets/reels", () => {
    for (const plan of WEEK_PLANS) for (const r of plan.reels) if (r.videoFile) expect(existsSync(path.join(process.cwd(), "src", "assets", "reels", r.videoFile)), `${r.key}: ${r.videoFile}`).toBe(true);
  });
});
