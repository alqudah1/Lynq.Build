import "server-only";

import { generateText, Output } from "ai";
import { z } from "zod";
import { getOfficeGenerationConfig } from "./models";
import type { RestaurantCandidate } from "./restaurant-research";

const outreachSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
});

const OUTREACH_START = "<!-- LYNQ_RESTAURANT_OUTREACH ";
const OUTREACH_END = " -->";

export function restaurantOutreachMarker(input: { messageId: string; recipient: string; previewUrl: string }): string {
  return `${OUTREACH_START}${JSON.stringify(input)}${OUTREACH_END}`;
}

export function parseRestaurantOutreach(content: string | null): { messageId: string; recipient: string; previewUrl: string } | null {
  if (!content) return null;
  const start = content.lastIndexOf(OUTREACH_START);
  const end = content.indexOf(OUTREACH_END, start + OUTREACH_START.length);
  if (start < 0 || end < 0) return null;
  try {
    return z.object({ messageId: z.string().uuid(), recipient: z.string().email(), previewUrl: z.string().url() }).parse(JSON.parse(content.slice(start + OUTREACH_START.length, end)));
  } catch {
    return null;
  }
}

export async function draftRestaurantOutreach(input: { candidate: RestaurantCandidate; previewUrl: string; founderDirective: string }): Promise<{ subject: string; body: string }> {
  if (!input.candidate.email) throw new Error("Outreach is waiting for a verified public business email for the approved restaurant");
  const result = await generateText({
    ...getOfficeGenerationConfig("review"),
    output: Output.object({ name: "RestaurantOutreachDraft", schema: outreachSchema }),
    system:
      "You write one concise, honest cold email from LYNQ to an independent restaurant. Mention that LYNQ prepared an unsolicited concept preview, not an official site. Include the exact preview URL. Explain one specific observed customer-journey problem and the practical benefit of the demo. Do not imply a relationship, promise results, use fake urgency, mention private data, or say the recipient opted in. End with a low-pressure question. Plain text only.",
    prompt: JSON.stringify({ founderDirective: input.founderDirective, restaurant: input.candidate, previewUrl: input.previewUrl }),
  });
  return outreachSchema.parse(result.output);
}
