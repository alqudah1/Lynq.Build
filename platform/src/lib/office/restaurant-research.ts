import "server-only";

import { google } from "@ai-sdk/google";
import { gateway, isStepCount, Output, ToolLoopAgent, type ToolSet } from "ai";
import { z } from "zod";
import { getOfficeGenerationConfig, isDirectGoogleModelConfigured } from "./models";

const sourceSchema = z.object({
  title: z.string().trim().min(1).max(300),
  url: z.string().url().max(2000),
  supports: z.string().trim().min(1).max(600),
});

export const restaurantCandidateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().min(1).max(500),
  city: z.string().trim().min(1).max(200),
  countryCode: z.enum(["CA", "JO"]),
  website: z.string().url().max(1000).nullable(),
  email: z.string().email().nullable(),
  phone: z.string().trim().max(100).nullable(),
  rating: z.number().min(0).max(5).nullable(),
  reviews: z.number().int().min(0).nullable(),
  websiteScore: z.number().int().min(0).max(100),
  opportunityScore: z.number().int().min(0).max(100),
  whySelected: z.string().trim().min(1).max(1200),
  websiteProblems: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
  demoOpportunities: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
  sources: z.array(sourceSchema).min(2).max(12),
});

const restaurantResearchSchema = z.object({
  searchArea: z.string().trim().min(1).max(300),
  recommendation: restaurantCandidateSchema,
  alternatives: z.array(restaurantCandidateSchema).min(1).max(4),
  uncertainty: z.array(z.string().trim().min(1).max(500)).max(8),
});

export type RestaurantCandidate = z.infer<typeof restaurantCandidateSchema>;
export type RestaurantResearch = z.infer<typeof restaurantResearchSchema>;

const RESEARCH_START = "<!-- LYNQ_RESTAURANT_RESEARCH ";
const RESEARCH_END = " -->";

export function restaurantResearchMarker(research: RestaurantResearch): string {
  return `${RESEARCH_START}${JSON.stringify(research)}${RESEARCH_END}`;
}

export function parseRestaurantResearch(content: string | null): RestaurantResearch | null {
  if (!content) return null;
  const start = content.lastIndexOf(RESEARCH_START);
  const end = content.indexOf(RESEARCH_END, start + RESEARCH_START.length);
  if (start < 0 || end < 0) return null;
  try {
    return restaurantResearchSchema.parse(JSON.parse(content.slice(start + RESEARCH_START.length, end)));
  } catch {
    return null;
  }
}

function renderCandidate(candidate: RestaurantCandidate, label: string): string {
  const contact = [candidate.email, candidate.phone].filter(Boolean).join(" · ") || "No verified public contact found";
  return `## ${label}: ${candidate.name}\n\n- Address: ${candidate.address}\n- Website: ${candidate.website ?? "No verified website found"}\n- Contact: ${contact}\n- Public rating: ${candidate.rating ?? "Not verified"}${candidate.reviews === null ? "" : ` (${candidate.reviews} reviews)`}\n- Website score: ${candidate.websiteScore}/100\n- Opportunity score: ${candidate.opportunityScore}/100\n\n${candidate.whySelected}\n\n### Problems worth solving\n\n${candidate.websiteProblems.map((item) => `- ${item}`).join("\n")}\n\n### Demo opportunities\n\n${candidate.demoOpportunities.map((item) => `- ${item}`).join("\n")}\n\n### Evidence\n\n${candidate.sources.map((source) => `- [${source.title}](${source.url}) — ${source.supports}`).join("\n")}`;
}

export function renderRestaurantResearch(research: RestaurantResearch): string {
  return [
    "# Restaurant prospect recommendation",
    `Search area: ${research.searchArea}`,
    renderCandidate(research.recommendation, "Recommended prospect"),
    ...research.alternatives.map((candidate, index) => renderCandidate(candidate, `Alternative ${index + 1}`)),
    "## What still needs verification",
    research.uncertainty.length > 0 ? research.uncertainty.map((item) => `- ${item}`).join("\n") : "- No material uncertainty reported beyond normal public-source limitations.",
    "## Founder decision",
    "Approve this restaurant before Product or Engineering starts. Request changes to make Jarvis research a different option. No outreach is sent at this stage.",
  ].join("\n\n");
}

export async function researchRestaurantProspects(input: { directive: string; revisionNote?: string | null }): Promise<RestaurantResearch> {
  const searchTools: ToolSet = isDirectGoogleModelConfigured()
    ? { google_search: google.tools.googleSearch({}) }
    : {
        perplexity_search: gateway.tools.perplexitySearch({
          maxResults: 12,
          maxTokensPerPage: 1200,
          maxTokens: 18_000,
          searchLanguageFilter: ["en"],
          country: "CA",
        }),
      };
  const agent = new ToolLoopAgent({
    ...getOfficeGenerationConfig("planning"),
    output: Output.object({ name: "RestaurantProspectResearch", schema: restaurantResearchSchema }),
    instructions:
      "You are LYNQ's evidence-first restaurant prospect researcher. You must use the web search tool before recommending anything. Find real independent restaurants whose public website or digital customer journey has a clear, ethical improvement opportunity. Prefer the location stated by the founder; if none is stated, search Toronto, Canada and state that assumption. Verify every candidate with at least two public URLs. Never invent an address, contact detail, rating, review count, website problem, or source. Use null when a contact or metric is not verified. Do not contact anyone. Return one best candidate and at least one real alternative.",
    tools: searchTools,
    stopWhen: isStepCount(6),
  });
  const result = await agent.generate({
    prompt: JSON.stringify({
      founderDirective: input.directive,
      revisionNote: input.revisionNote ?? null,
      requiredChecks: [
        "restaurant identity and location",
        "current official website or evidence no official website exists",
        "public contact details only when verified",
        "specific observable website or conversion problems",
        "a demo concept LYNQ can build without using protected assets deceptively",
      ],
    }),
  });
  return restaurantResearchSchema.parse(result.output);
}
