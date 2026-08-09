import { z } from "zod";
import { getKnowledgeContextForAgent } from "@/lib/agents/brain-reads";
import type { ToolImplementation } from "../implementation-types";

/**
 * brain.get_context — read-only, permission-aware, citation-ready
 * retrieval of one knowledge item's approved content, version, trust,
 * source, evidence, and relationship metadata (Brain Module 16's existing
 * `getKnowledgeContextForAgent`, reused directly — never re-implemented).
 * The exact bundle this tool returns is what `artifact.create_report`'s
 * citations are mechanically derived from.
 */
export const brainGetContextInputSchema = z
  .object({
    knowledgeItemId: z.string().uuid(),
    versionNumber: z.coerce.number().int().min(1),
  })
  .strict();

export type BrainGetContextInput = z.infer<typeof brainGetContextInputSchema>;

export const brainGetContextTool: ToolImplementation<BrainGetContextInput, Awaited<ReturnType<typeof getKnowledgeContextForAgent>>> = {
  toolKey: "brain.get_context",
  version: 1,
  inputSchema: brainGetContextInputSchema,
  execute: async (ctx, input) => {
    return getKnowledgeContextForAgent(ctx.db, ctx.principal, input.knowledgeItemId, input.versionNumber);
  },
};
