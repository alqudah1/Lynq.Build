import "server-only";

import { google } from "@ai-sdk/google";
import { gateway, isStepCount, Output, ToolLoopAgent, type ToolSet } from "ai";
import { getOfficeGenerationConfig, isDirectGoogleModelConfigured } from "./models";
import type { RestaurantCandidate } from "./restaurant-research";
import {
  collectedBrandPackSchema,
  emptyBrandPack,
  normalizeBrandPack,
  type BrandPack,
  type CollectedBrandPack,
} from "./website/brand-pack";

/**
 * The evidence-collection pass of the research stage.
 *
 * A model is a good reader of public pages and a poor custodian of facts,
 * so the division here mirrors the rest of the pipeline: the collector is
 * asked to *quote and cite*, and `normalizeBrandPack` decides what
 * survives. Anything without an approved source, a real retrieval date and
 * a verified confidence is dropped and reported, never filled in.
 *
 * Collection failing is not fatal. A prospect with no brand evidence still
 * deserves to reach the founder — with the gap stated plainly — rather
 * than stalling the whole directive.
 */

export type BrandCollectionOutcome = {
  pack: BrandPack;
  /** Plain-language reason the pack is thinner than it should be, or null. */
  failure: string | null;
};

export type BrandPackCollector = (input: { candidate: RestaurantCandidate; today: string }) => Promise<CollectedBrandPack>;

const INSTRUCTIONS = `You are LYNQ's evidence collector. You are gathering public material about ONE named restaurant so a concept website can be built without inventing anything.

Collect only from sources that belong to this business or already cite it: its official website, its official social profiles, its published menu, and the public listings named in the research. Nothing else is admissible.

For every single item you return you must supply:
- sourceUrl: the exact https page you read it on
- sourceType: official_website, official_social, public_menu, public_listing or founder_supplied
- retrievedAt: today's date, as given to you
- confidence: "verified" only when you read the value on that page yourself; "reported" when a source paraphrases it; "uncertain" when you are guessing
- note: how you saw it, in a few words

Rules that matter more than completeness:
- Never fill a field you did not read. An absent phone number is correct; an invented one is not.
- Never smooth over a disagreement. If two sources give different opening hours, return both entries and let the pipeline record the conflict.
- Images may only come from the business's own website or its own social profile, and each needs alternative text describing what is actually in the picture.
- Menu items and prices must appear on a published menu. Do not infer a price from a category.
- Put anything you saw but could not confirm into "uncertain" with the reason.

Return less rather than more. Every item you cannot stand behind costs the founder time.`;

function searchTools(): ToolSet {
  return (isDirectGoogleModelConfigured()
    ? { google_search: google.tools.googleSearch({}) }
    : {
        perplexity_search: gateway.tools.perplexitySearch({
          maxResults: 12,
          maxTokensPerPage: 1500,
          maxTokens: 20_000,
          searchLanguageFilter: ["en"],
          country: "CA",
        }),
      }) as unknown as ToolSet;
}

const defaultCollector: BrandPackCollector = async ({ candidate, today }) => {
  const agent = new ToolLoopAgent({
    ...getOfficeGenerationConfig("planning"),
    output: Output.object({ name: "RestaurantBrandEvidence", schema: collectedBrandPackSchema }),
    instructions: INSTRUCTIONS,
    tools: searchTools(),
    stopWhen: isStepCount(8),
  });
  const result = await agent.generate({
    prompt: JSON.stringify({
      restaurant: { name: candidate.name, address: candidate.address, city: candidate.city, countryCode: candidate.countryCode },
      officialWebsite: candidate.website,
      knownSources: candidate.sources.map((source) => source.url),
      today,
      wanted: [
        "official website and official social profiles",
        "published menu categories and items, with prices only when printed",
        "opening hours exactly as published",
        "public contact details",
        "services the business states it offers",
        "images published by the business itself, with alternative text",
        "phrases the business uses about itself",
      ],
    }),
  });
  return collectedBrandPackSchema.parse(result.output);
};

export async function collectRestaurantBrandPack(input: {
  candidate: RestaurantCandidate;
  now?: Date;
  /** Test seam. Production uses the search-enabled Office collector. */
  collector?: BrandPackCollector;
}): Promise<BrandCollectionOutcome> {
  const now = input.now ?? new Date();
  const restaurant = {
    name: input.candidate.name,
    address: input.candidate.address,
    city: input.candidate.city,
    countryCode: input.candidate.countryCode,
  };
  const collect = input.collector ?? defaultCollector;

  let collected: CollectedBrandPack;
  try {
    collected = await collect({ candidate: input.candidate, today: now.toISOString().slice(0, 10) });
  } catch (error) {
    return {
      pack: emptyBrandPack(restaurant, now.toISOString().slice(0, 10)),
      failure: `Jarvis could not finish gathering public evidence for ${input.candidate.name}: ${(error as Error).message?.slice(0, 200) ?? "the research provider did not respond"}. The prospect is still shown, with no menu, images or opening hours.`,
    };
  }

  const parsed = collectedBrandPackSchema.safeParse(collected);
  if (!parsed.success) {
    return {
      pack: emptyBrandPack(restaurant, now.toISOString().slice(0, 10)),
      failure: `The evidence Jarvis gathered for ${input.candidate.name} did not include the sources every item needs, so none of it is being used.`,
    };
  }

  return {
    pack: normalizeBrandPack({
      collected: parsed.data,
      restaurant,
      officialWebsite: input.candidate.website,
      researchSources: input.candidate.sources.map((source) => source.url),
      now,
    }),
    failure: null,
  };
}
