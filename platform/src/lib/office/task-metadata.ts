import { z } from "zod";

export const officeDeliveryStageSchema = z.enum(["product", "engineering", "qa", "advisory"]);
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
  return `${metadata.goal}\n\nHandoff: ${metadata.handoff}\n\n${START}${JSON.stringify(metadata)}${END}`;
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
