import { describe, expect, it } from "vitest";
import { explainJarvisFailure, extractEngineeringLinks, extractFounderDirective, jarvisRecommendation, summarizeDemoDelivery } from "./jarvis-presentation";

describe("Jarvis presentation helpers", () => {
  it("extracts the founder's original directive", () => {
    expect(extractFounderDirective("Founder directive\n\nBuild a client demo overnight.\n\nExecutive Assistant kickoff\n\nStarting now.")).toBe("Build a client demo overnight.");
    expect(extractFounderDirective("Ordinary project")).toBeNull();
  });

  it("extracts real pull request and preview links from engineering evidence", () => {
    expect(extractEngineeringLinks("- Pull request: https://github.com/a/b/pull/1\n- Preview: https://preview.vercel.app")).toEqual({
      pullRequestUrl: "https://github.com/a/b/pull/1",
      previewUrl: "https://preview.vercel.app",
    });
  });

  it("never recommends bypassing a pending approval", () => {
    expect(jarvisRecommendation("needs_approval")).toContain("will not continue");
  });
});

describe("failures in plain language", () => {
  it("returns nothing when there is nothing wrong", () => {
    expect(explainJarvisFailure(null)).toBeNull();
    expect(explainJarvisFailure("   ")).toBeNull();
  });

  it.each([
    ["Engineering is waiting for the founder to approve the restaurant (Sumac & Stone) before any website is built", /waiting for your decision/i],
    ["The evidence on this project has changed since you approved it, so Jarvis stopped rather than building from something you have not seen.", /evidence changed after you approved it/i],
    ["This prospect has no approved evidence version recorded, so there is nothing to build from.", /no approved evidence to build from/i],
    ["The generated website did not pass validation after 3 attempt(s): dead_anchor at nav", /did not pass Jarvis's own checks/i],
    ["The website generation provider failed after 3 attempt(s): 503", /did not respond/i],
    ["The route /demos/x already belongs to project OTHER; refusing to overwrite another prospect's demo", /already taken by another project/i],
    ["Quality Assurance is waiting for the preview link.", /preview has not appeared yet/i],
    ["Outreach is ready, but a verified Resend email connection is not connected in Communications", /email is not connected/i],
    ["GitHub request failed (404)", /cannot reach the code repository/i],
    ["Outreach is waiting for the founder to approve the built demo", /never accepted/i],
    // Not the same sentence as QA's, and it used to fall through to the
    // generic "this step stopped" — which told the founder nothing about
    // why no email went out.
    ["Outreach is waiting for a working preview link. Nothing is sent while the demo the email would point at cannot be opened.", /preview has not appeared yet/i],
  ])("explains %s", (raw, expected) => {
    const failure = explainJarvisFailure(raw)!;
    expect(failure.headline).toMatch(expected);
    expect(failure.detail.length).toBeGreaterThan(20);
    expect(failure.nextStep.length).toBeGreaterThan(10);
    expect(failure.technical).toBe(raw);
  });

  it("never hides a message it does not recognise", () => {
    const failure = explainJarvisFailure("ECONNRESET while talking to the sandbox")!;
    expect(failure.headline).toBe("This step stopped and needs a look");
    expect(failure.detail).toContain("ECONNRESET");
    expect(failure.technical).toBe("ECONNRESET while talking to the sandbox");
  });

  it("truncates an enormous message in the summary but keeps all of it in the technical detail", () => {
    const raw = `x${"y".repeat(900)}`;
    const failure = explainJarvisFailure(raw)!;
    expect(failure.detail.endsWith("…")).toBe(true);
    expect(failure.detail.length).toBeLessThan(raw.length);
    expect(failure.technical).toBe(raw);
  });
});

describe("whether a demo is actually built", () => {
  const marker = (delivery: Record<string, unknown>) => `<!-- LYNQ_ENGINEERING_RESULT ${JSON.stringify(delivery)} -->\n\n# Engineering delivery`;
  const built = {
    previewPath: "/demos/sumac-abc123def456",
    commitSha: "abc123",
    previewUrl: "https://preview.vercel.app/demos/sumac-abc123def456",
    previewStatus: "ready",
    pullRequestUrl: "https://github.com/o/r/pull/7",
  };

  it("reports a demo as built only when the route, the commit and the preview all exist", () => {
    expect(summarizeDemoDelivery(marker(built))).toEqual({
      built: true,
      route: "/demos/sumac-abc123def456",
      commitSha: "abc123",
      previewUrl: "https://preview.vercel.app/demos/sumac-abc123def456",
      pullRequestUrl: "https://github.com/o/r/pull/7",
      missing: [],
    });
  });

  it("refuses to call a commit without a live preview a finished demo", () => {
    const summary = summarizeDemoDelivery(marker({ ...built, previewUrl: null, previewStatus: "pending" }));
    expect(summary.built).toBe(false);
    expect(summary.previewUrl).toBeNull();
    expect(summary.missing).toEqual(["a working preview link"]);
  });

  it("does not trust a preview link whose deployment was never confirmed", () => {
    const summary = summarizeDemoDelivery(marker({ ...built, previewStatus: "unavailable" }));
    expect(summary.built).toBe(false);
    expect(summary.previewUrl).toBeNull();
  });

  it("reports nothing at all for an artifact that carries no delivery", () => {
    expect(summarizeDemoDelivery("# Just a report").built).toBe(false);
    expect(summarizeDemoDelivery(null).commitSha).toBeNull();
    expect(summarizeDemoDelivery("<!-- LYNQ_ENGINEERING_RESULT {not json} -->").commitSha).toBeNull();
  });
});

describe("a project that has been revised", () => {
  const marker = (delivery: Record<string, unknown>) => `<!-- LYNQ_ENGINEERING_RESULT ${JSON.stringify(delivery)} -->`;
  const rejected = { previewPath: "/demos/x", commitSha: "old111", previewUrl: "https://old.vercel.app/demos/x", previewStatus: "ready", pullRequestUrl: "https://github.com/o/r/pull/1" };
  const revised = { previewPath: "/demos/x", commitSha: "new222", previewUrl: "https://new.vercel.app/demos/x", previewStatus: "ready", pullRequestUrl: "https://github.com/o/r/pull/2" };

  it("describes the newest delivery, not the one the founder rejected", () => {
    const context = [marker(rejected), "# Founder review", marker(revised), "# Revised delivery"].join("\n\n");
    expect(summarizeDemoDelivery(context)).toMatchObject({ commitSha: "new222", previewUrl: "https://new.vercel.app/demos/x", pullRequestUrl: "https://github.com/o/r/pull/2" });
  });

  it("does not fall back to a superseded build when the newest one has no preview", () => {
    const context = [marker(rejected), marker({ ...revised, previewUrl: null, previewStatus: "pending" })].join("\n\n");
    const summary = summarizeDemoDelivery(context);
    expect(summary.built).toBe(false);
    expect(summary.commitSha).toBe("new222");
    expect(summary.previewUrl).toBeNull();
  });

  it("skips a damaged newest record rather than reporting nothing at all", () => {
    const context = [marker(rejected), "<!-- LYNQ_ENGINEERING_RESULT {broken -->"].join("\n\n");
    expect(summarizeDemoDelivery(context).commitSha).toBe("old111");
  });
});
