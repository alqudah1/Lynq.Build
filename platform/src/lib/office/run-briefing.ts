import { parseAutoDecisions, parseIncompleteOutcomes, type AutonomyPolicy } from "./autonomy";
import { summarizeDemoDelivery } from "./jarvis-presentation";
import { parseRestaurantOutreach } from "./restaurant-outreach";
import { parseRestaurantResearch } from "./restaurant-research";
import { fingerprintBrandPack, parseBrandPack } from "./website/brand-pack";

/**
 * The one message at the end.
 *
 * A founder who hands a directive over and goes to work does not want a
 * running commentary; he wants to come back to a single account of what
 * happened — what was found, what was built, what he can look at, what
 * Jarvis decided without him, what it could not finish, and what still
 * needs him. This assembles that from the project's own record rather
 * than from a narrative kept in memory, so it is accurate even when the
 * run was picked up and continued by a different worker.
 */

export type RunBriefing = {
  /** One line, for the email subject and the voice call. */
  headline: string;
  /** The founder-facing report, stored as a project artifact. */
  markdown: string;
  /** Things that still need Mustafa. Empty means the run is genuinely done. */
  needsFounder: string[];
  /** True only when a preview actually exists. */
  demoBuilt: boolean;
};

export function buildRunBriefing(input: { projectName: string; sharedContext: string; policy: AutonomyPolicy }): RunBriefing {
  const research = parseRestaurantResearch(input.sharedContext);
  const pack = parseBrandPack(input.sharedContext);
  const demo = summarizeDemoDelivery(input.sharedContext);
  const outreach = parseRestaurantOutreach(input.sharedContext);
  const decisions = parseAutoDecisions(input.sharedContext);
  const incomplete = parseIncompleteOutcomes(input.sharedContext);
  const restaurant = research?.recommendation.name ?? null;

  const needsFounder: string[] = [];
  if (!demo.built) needsFounder.push(`The demo is not finished — still missing ${demo.missing.join(" and ") || "its preview"}.`);
  if (outreach && input.policy.outreach === "ask") needsFounder.push(`One email to ${outreach.recipient} is drafted and waiting for your approval.`);
  for (const item of incomplete) needsFounder.push(`${item.headline} — ${item.detail}`);

  const headline = restaurant
    ? demo.built
      ? `${restaurant}: concept site built and ready to look at${outreach ? (input.policy.outreach === "auto" ? ", email sent" : ", email waiting for you") : ""}`
      : `${restaurant}: researched, but the demo did not finish`
    : `${input.projectName}: finished`;

  const markdown = [
    `# ${input.projectName} — what Jarvis did`,
    "",
    `**${headline}**`,
    "",
    input.policy.build === "auto"
      ? `Jarvis ran this without stopping. ${input.policy.reason}`
      : `Jarvis stopped for your decision at each gate. ${input.policy.reason}`,
    "",
    "## The prospect",
    "",
    restaurant
      ? [
          `**${restaurant}** — ${research!.recommendation.address}`,
          "",
          research!.recommendation.whySelected,
          "",
          "Why it was worth approaching:",
          research!.recommendation.websiteProblems.map((problem) => `- ${problem}`).join("\n"),
        ].join("\n")
      : "_No restaurant was selected on this directive._",
    "",
    "## The evidence behind it",
    "",
    pack
      ? [
          `${pack.facts.length} verified fact${pack.facts.length === 1 ? "" : "s"}, ${pack.images.length} image${pack.images.length === 1 ? "" : "s"}, ${pack.menu.length} menu section${pack.menu.length === 1 ? "" : "s"} and ${pack.hours.length} opening-hours row${pack.hours.length === 1 ? "" : "s"}, all read from the business's own pages on ${pack.collectedAt}.`,
          "",
          `Evidence version \`${fingerprintBrandPack(pack)}\`.`,
          pack.conflicts.length > 0 ? `\n${pack.conflicts.length} place${pack.conflicts.length === 1 ? "" : "s"} where two sources disagreed. Jarvis used neither value.` : "",
          pack.uncertain.length > 0 ? `\nNot verified, and therefore not on the site:\n${pack.uncertain.slice(0, 8).map((item) => `- ${item.label} — ${item.reason}`).join("\n")}` : "",
        ].join("\n")
      : "_No public evidence was gathered, so nothing was built from it._",
    "",
    "## What was built",
    "",
    demo.built
      ? [
          `- Look at it: ${demo.previewUrl}`,
          `- Code: ${demo.pullRequestUrl ?? "no pull request recorded"}`,
          `- Commit: \`${demo.commitSha}\``,
          "",
          "The route, the commit and the preview were all checked before this was called built.",
        ].join("\n")
      : `_Not finished. Still missing ${demo.missing.join(" and ") || "a delivery record"}._`,
    "",
    "## What Jarvis decided without you",
    "",
    decisions.length > 0
      ? decisions
          .map((decision) => `- **${decision.summary}** (${decision.decidedAt.slice(0, 10)})${decision.brandPackFingerprint ? ` · evidence \`${decision.brandPackFingerprint}\`` : ""}${decision.commitSha ? ` · commit \`${decision.commitSha}\`` : ""}`)
          .join("\n")
      : "- Nothing. Every gate on this run was decided by you.",
    "",
    "## Outreach",
    "",
    outreach
      ? input.policy.outreach === "auto"
        ? `One email was queued to ${outreach.recipient}, pointing at ${outreach.previewUrl}. Exactly one message, to one address.`
        : `One email to ${outreach.recipient} is drafted and waiting for your approval. Nothing has been sent.`
      : "_No outreach was drafted on this run._",
    "",
    "## What still needs you",
    "",
    needsFounder.length > 0 ? needsFounder.map((item) => `- ${item}`).join("\n") : "- Nothing. This one is finished.",
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { headline, markdown, needsFounder, demoBuilt: demo.built };
}
