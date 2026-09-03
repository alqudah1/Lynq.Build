import { deriveDesignProposal, resolveDesignDirection, type DesignDirection } from "./design";
import { fingerprintBrandPack, type BrandPack } from "./brand-pack";

/**
 * What the founder actually reads before approving a prospect.
 *
 * The point of this page is that approving is an informed act: the
 * restaurant, every fact with its source and retrieval date, the images
 * that would be used, the menu and hours that were verified, everything
 * that could *not* be verified, every place two sources disagreed, and the
 * design direction being recommended. The evidence version is printed on
 * it, because that version is what the approval binds to — re-collecting
 * afterwards produces a different version and needs a fresh decision.
 */

export type ProspectReviewInput = {
  restaurantName: string;
  pack: BrandPack;
  /** Plain-language note when evidence collection did not finish. */
  collectionFailure: string | null;
  /** Uncertainty the research stage itself reported. */
  researchUncertainty: string[];
};

/**
 * The design a prospect would get before any model has weighed in, derived
 * from its identity alone. It is shown at approval time so the founder is
 * approving a direction rather than a surprise.
 */
export function recommendedDesignDirection(identity: string): DesignDirection {
  return resolveDesignDirection(deriveDesignProposal(identity));
}

function table(header: string[], rows: string[][]): string {
  if (rows.length === 0) return "_Nothing verified._";
  const escape = (cell: string) => cell.replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escape).join(" | ")} |`),
  ].join("\n");
}

function bullets(items: string[], empty: string): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`;
}

export function renderProspectApproval(input: ProspectReviewInput): string {
  const { pack } = input;
  const fingerprint = fingerprintBrandPack(pack);
  const design = recommendedDesignDirection(`${pack.restaurant.name} · ${pack.restaurant.city} · ${pack.restaurant.countryCode}`);

  const factRows = pack.facts.map((fact) => [fact.label, fact.value, `[source](${fact.provenance.sourceUrl})`, fact.provenance.retrievedAt, fact.provenance.confidence]);
  const hoursRows = pack.hours.map((row) => [row.day, row.hours, `[source](${row.provenance.sourceUrl})`, row.provenance.retrievedAt]);
  const serviceRows = pack.services.map((service) => [service.capability, service.label, service.detail ?? "—", `[source](${service.provenance.sourceUrl})`]);
  const imageRows = pack.images.map((image) => [image.alt, image.kind, `[image](${image.url})`, `[source](${image.provenance.sourceUrl})`, image.provenance.retrievedAt]);
  const conflictRows = pack.conflicts.map((conflict) => [conflict.label, conflict.values.map((value) => `"${value.value}"`).join(" vs "), conflict.values.map((value) => `[source](${value.sourceUrl})`).join(" · ")]);

  return [
    `# Approve the prospect and its evidence — ${input.restaurantName}`,
    "",
    `**Evidence version:** \`${fingerprint}\` · collected ${pack.collectedAt}`,
    "",
    "Approving accepts this restaurant **and this exact set of evidence**. If Jarvis gathers evidence again, the version changes and it will ask you to approve it again before anything is built.",
    input.collectionFailure ? `\n> **Evidence collection did not finish.** ${input.collectionFailure}` : "",
    "",
    "## The restaurant",
    "",
    table(
      ["Field", "Value"],
      [
        ["Name", pack.restaurant.name],
        ["Address", pack.restaurant.address],
        ["City", pack.restaurant.city],
        ["Country", pack.restaurant.countryCode],
      ],
    ),
    "",
    "## Verified facts",
    "",
    "Every row was read on the page named beside it. Anything Jarvis could not read is in *Not verified* below, never on the site.",
    "",
    table(["Fact", "Value", "Source", "Retrieved", "Confidence"], factRows),
    "",
    "## Opening hours",
    "",
    table(["Day", "Hours", "Source", "Retrieved"], hoursRows),
    "",
    "## Services the business states it offers",
    "",
    "Only these may be offered on the generated site. Anything absent here — delivery, online ordering, catering — will not appear.",
    "",
    table(["Capability", "Label", "Detail", "Source"], serviceRows),
    "",
    "## Menu",
    "",
    pack.menu.length > 0
      ? pack.menu
          .map((category) => `### ${category.name}\n\n${category.description ? `${category.description}\n\n` : ""}${category.items.map((item) => `- ${item.name}${item.price ? ` — ${item.price}` : ""}${item.description ? ` · ${item.description}` : ""}`).join("\n")}\n\nSource: [${category.provenance.sourceType}](${category.provenance.sourceUrl}) · retrieved ${category.provenance.retrievedAt}`)
          .join("\n\n")
      : "_No published menu was verified, so the site will not describe any dish._",
    "",
    "## Images",
    "",
    "Only images published by the business itself are used, with the alternative text below.",
    "",
    table(["Alternative text", "Kind", "Image", "Source page", "Retrieved"], imageRows),
    "",
    "## Where sources disagree",
    "",
    conflictRows.length > 0
      ? `${table(["Fact", "Values", "Sources"], conflictRows)}\n\nJarvis uses none of these. Tell it which source to trust, or approve without them.`
      : "_No source disagreed with another._",
    "",
    "## Not verified",
    "",
    bullets(
      [...input.researchUncertainty, ...pack.uncertain.map((item) => `${item.label} — ${item.detail} (${item.reason})`)],
      "Nothing beyond the usual limits of public sources.",
    ),
    "",
    "## Recommended design direction",
    "",
    `**${design.name}** — ${design.rationale}`,
    "",
    table(
      ["Decision", "Value"],
      [
        ["Layout", design.layout],
        ["Type system", design.typeSystem],
        ["Motif", design.motif],
        ["Density", design.density],
        ["Scheme", design.palette.scheme],
        ["Ground / ink", `\`${design.palette.background}\` / \`${design.palette.ink}\``],
        ["Accent", `\`${design.palette.accent}\``],
      ],
    ),
    "",
    "## Your decision",
    "",
    "- **Approve** — Jarvis builds a concept website from exactly this evidence. Nothing is sent to the restaurant.",
    "- **Request changes** — Jarvis researches a different restaurant, or gathers the evidence again.",
    "- **Stop** — nothing further happens on this directive.",
    "",
    "No message reaches the restaurant at this stage, or at any stage before you approve the finished demo and then the exact email.",
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A one-line record of what the founder approved, for the approval summary itself. */
export function approvalSummaryLine(pack: BrandPack): string {
  const counts = [
    `${pack.facts.length} verified fact${pack.facts.length === 1 ? "" : "s"}`,
    `${pack.images.length} image${pack.images.length === 1 ? "" : "s"}`,
    `${pack.menu.length} menu section${pack.menu.length === 1 ? "" : "s"}`,
    `${pack.hours.length} opening-hours row${pack.hours.length === 1 ? "" : "s"}`,
  ];
  const caveats = pack.conflicts.length > 0 ? `, ${pack.conflicts.length} source disagreement${pack.conflicts.length === 1 ? "" : "s"}` : "";
  return `${counts.join(", ")}${caveats}, evidence version ${fingerprintBrandPack(pack)}`;
}
