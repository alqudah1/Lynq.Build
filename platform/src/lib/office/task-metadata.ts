import { z } from "zod";

export const officeDeliveryStageSchema = z.enum(["research", "product", "engineering", "qa", "outreach", "advisory"]);
export type OfficeDeliveryStage = z.infer<typeof officeDeliveryStageSchema>;

const metadataSchema = z.object({
  version: z.literal(1),
  stage: officeDeliveryStageSchema,
  agentId: z.string().uuid(),
  goal: z.string().min(1).max(5000),
  successCriteria: z.string().min(1).max(5000),
  handoff: z.string().max(1000),
});

export type OfficeTaskMetadata = z.infer<typeof metadataSchema>;

const START = "<!-- LYNQ_OFFICE_TASK ";
const END = " -->";

export function formatOfficeTaskDescription(metadata: OfficeTaskMetadata): string {
  return `${metadata.goal}\n\nHandoff: ${metadata.handoff}\n\n${START}${encodeEnvelope(metadata)}${END}`;
}

/**
 * Serializes the metadata so it cannot contain its own terminator.
 *
 * `parseOfficeTaskMetadata` finds the end of the envelope with `indexOf(" -->")`,
 * and `JSON.stringify` does not escape `>`, so any goal or success criterion
 * containing the literal sequence ` -->` ends the envelope early: the slice is
 * truncated JSON, the parse throws, and the metadata reads as absent. That is
 * not a loud failure — `execution.ts` skips a handoff whose metadata is missing
 * with `continue`, so a sequential chain stops mid-way with nothing marked
 * failed and no event recorded. It became reachable when founder-dictated text
 * started flowing into `goal`.
 *
 * `>` parses back to exactly the same string, so this changes what is
 * WRITTEN and nothing about what is read: envelopes already in the database
 * parse as they always did.
 */
function encodeEnvelope(metadata: OfficeTaskMetadata): string {
  return JSON.stringify(metadata).replace(/>/g, "\\u003e");
}

export function parseOfficeTaskMetadata(description: string | null): OfficeTaskMetadata | null {
  if (!description) return null;
  const start = description.lastIndexOf(START);
  if (start < 0) return null;
  const end = description.indexOf(END, start + START.length);
  if (end < 0) return null;
  try {
    return metadataSchema.parse(JSON.parse(description.slice(start + START.length, end)));
  } catch {
    return null;
  }
}
