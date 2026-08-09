import { z } from "zod";
import { knowledgeDomainSchema } from "@/lib/brain/validation";
import { searchKnowledgeItemsForAgent } from "@/lib/brain/search";
import type { ToolImplementation } from "../implementation-types";

/**
 * brain.search — read-only, permission-aware, tenant/workspace-scoped
 * keyword search over Brain knowledge (Brain Module 10's existing
 * deterministic full-text layer, via Module 8's new `searchKnowledgeItemsForAgent`
 * sibling — never a second search implementation). No AI synthesis
 * anywhere in this tool: it returns exactly what the deterministic ranked
 * query found, nothing paraphrased or summarized.
 */
export const brainSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    domain: knowledgeDomainSchema.optional(),
    workspaceId: z.string().uuid().nullable().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict();

export type BrainSearchInput = z.infer<typeof brainSearchInputSchema>;

export interface BrainSearchResultItem {
  knowledgeItemId: string;
  versionNumber: number;
  title: string;
  domain: string;
  classification: string;
  status: string;
  rank: number;
}

export interface BrainSearchOutput {
  results: BrainSearchResultItem[];
  nextCursor: string | null;
}

export const brainSearchTool: ToolImplementation<BrainSearchInput, BrainSearchOutput> = {
  toolKey: "brain.search",
  version: 1,
  inputSchema: brainSearchInputSchema,
  resolveRequiredDomains: (input) => (input.domain ? [input.domain] : []),
  execute: async (ctx, input) => {
    const result = await searchKnowledgeItemsForAgent(ctx.db, {
      organizationId: ctx.organizationId,
      query: input.query,
      domain: input.domain,
      workspaceId: input.workspaceId,
      agentId: ctx.principal.agentId,
      limit: input.limit,
    });

    return {
      results: result.results.map((r) => ({
        knowledgeItemId: r.item.id,
        versionNumber: r.item.currentVersionNumber,
        title: r.item.title,
        domain: r.item.domain,
        classification: r.item.classification,
        status: r.item.status,
        rank: r.rank,
      })),
      nextCursor: result.nextCursor,
    };
  },
};
