import { describe, expect, it } from "vitest";
import { brandPack, candidate } from "../../../test/support/website-fixtures";
import { autoDecisionMarker, DEFAULT_AUTONOMY, incompleteOutcomeMarker, type AutonomyPolicy } from "./autonomy";
import { buildRunBriefing } from "./run-briefing";
import { restaurantOutreachMarker } from "./restaurant-outreach";
import { brandPackMarker } from "./website/brand-pack";

/**
 * The one message a founder gets when he comes back. It has to be true
 * about what happened — especially about what did not.
 */

const HANDED_OVER: AutonomyPolicy = { build: "auto", outreach: "auto", reason: "You told Jarvis to run this end to end." };

const research = `<!-- LYNQ_RESTAURANT_RESEARCH ${JSON.stringify({
  searchArea: "Toronto, Canada",
  recommendation: candidate,
  alternatives: [candidate],
  uncertainty: [],
})} -->`;

const builtDelivery = `<!-- LYNQ_ENGINEERING_RESULT ${JSON.stringify({
  previewPath: "/demos/sumac-abc123def456",
  commitSha: "abc123",
  previewUrl: "https://preview.vercel.app/demos/sumac-abc123def456",
  previewStatus: "ready",
  pullRequestUrl: "https://github.com/o/r/pull/7",
})} -->`;

const decision = autoDecisionMarker({
  action: "restaurant_prospect_selection",
  decidedAt: "2026-08-20T09:00:00.000Z",
  policyReason: "handed over",
  summary: "Went ahead with Sumac & Stone.",
  restaurantName: "Sumac & Stone",
  brandPackFingerprint: "abc123def",
  commitSha: null,
});

function context(...parts: string[]): string {
  return [research, brandPackMarker(brandPack), ...parts].join("\n\n");
}

describe("the end-of-run report", () => {
  it("leads with what happened and links the thing to look at", () => {
    const briefing = buildRunBriefing({ projectName: "Sumac demo", sharedContext: context(builtDelivery, decision), policy: HANDED_OVER });
    expect(briefing.demoBuilt).toBe(true);
    expect(briefing.headline).toContain("Sumac & Stone");
    expect(briefing.headline).toContain("ready to look at");
    expect(briefing.markdown).toContain("https://preview.vercel.app/demos/sumac-abc123def456");
    expect(briefing.markdown).toContain("412 Dundas Street West");
    expect(briefing.needsFounder).toEqual([]);
  });

  it("names every decision Jarvis took without him", () => {
    const briefing = buildRunBriefing({ projectName: "Sumac demo", sharedContext: context(builtDelivery, decision), policy: HANDED_OVER });
    expect(briefing.markdown).toContain("## What Jarvis decided without you");
    expect(briefing.markdown).toContain("Went ahead with Sumac & Stone.");
    expect(briefing.markdown).toContain("evidence `abc123def`");
  });

  it("says how much evidence it stood on, and what it could not verify", () => {
    const briefing = buildRunBriefing({ projectName: "Sumac demo", sharedContext: context(builtDelivery), policy: HANDED_OVER });
    expect(briefing.markdown).toContain("2 verified facts, 3 images, 2 menu sections and 2 opening-hours rows");
    expect(briefing.markdown).toContain("read from the business's own pages on 2026-08-20");
  });

  it("refuses to call an unfinished demo done, and puts it on the founder's list", () => {
    const pending = `<!-- LYNQ_ENGINEERING_RESULT ${JSON.stringify({ previewPath: "/demos/x", commitSha: "abc123", previewUrl: null, previewStatus: "pending" })} -->`;
    const briefing = buildRunBriefing({ projectName: "Sumac demo", sharedContext: context(pending), policy: HANDED_OVER });
    expect(briefing.demoBuilt).toBe(false);
    expect(briefing.headline).toContain("the demo did not finish");
    expect(briefing.needsFounder[0]).toContain("a working preview link");
  });

  it("carries every gap the run recorded through to the founder", () => {
    const gap = incompleteOutcomeMarker({
      stage: "outreach",
      headline: "No public email address was verified",
      detail: "Jarvis will not guess an address.",
      recordedAt: "2026-08-20T11:00:00.000Z",
    });
    const briefing = buildRunBriefing({ projectName: "Sumac demo", sharedContext: context(builtDelivery, gap), policy: HANDED_OVER });
    expect(briefing.needsFounder).toContain("No public email address was verified — Jarvis will not guess an address.");
  });

  it("distinguishes an email that was sent from one that is waiting", () => {
    const outreach = restaurantOutreachMarker({
      messageId: "7f1b3d2e-8a4c-4f11-9a0e-2b6d5c8e9f01",
      recipient: "hello@sumacandstone.example.ca",
      previewUrl: "https://preview.vercel.app/demos/sumac-abc123def456",
    });
    const sent = buildRunBriefing({ projectName: "Sumac demo", sharedContext: context(builtDelivery, outreach), policy: HANDED_OVER });
    expect(sent.markdown).toContain("One email was queued to hello@sumacandstone.example.ca");
    expect(sent.needsFounder).toEqual([]);

    const waiting = buildRunBriefing({ projectName: "Sumac demo", sharedContext: context(builtDelivery, outreach), policy: DEFAULT_AUTONOMY });
    expect(waiting.markdown).toContain("waiting for your approval");
    expect(waiting.needsFounder[0]).toContain("waiting for your approval");
  });

  it("is honest about a run that found nothing", () => {
    const briefing = buildRunBriefing({ projectName: "Empty run", sharedContext: "no markers at all", policy: HANDED_OVER });
    expect(briefing.demoBuilt).toBe(false);
    expect(briefing.markdown).toContain("_No restaurant was selected on this directive._");
    expect(briefing.markdown).toContain("Nothing. Every gate on this run was decided by you.");
  });
});
