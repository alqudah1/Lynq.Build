import { z } from "zod";
import { resolveExecutionById } from "@/lib/agent-runtime/executions";
import { listMessagesForConversation } from "@/lib/communications-os/messages";
import type { ToolImplementation } from "../implementation-types";

const MAX_BODY_PREVIEW = 500;
const MAX_MESSAGES = 20;

/**
 * communications.list_conversation — read_only. Bounded conversation
 * context for an agent's own drafting task — "agents receive minimum
 * context": message bodies are truncated previews, not full history, and
 * the call is gated by the launching human's own Communications view
 * authority via `listMessagesForConversation`, never a separate agent-only
 * bypass.
 */
export const communicationsListConversationInputSchema = z.object({ conversationId: z.string().uuid(), limit: z.coerce.number().int().min(1).max(MAX_MESSAGES).default(10) }).strict();
export type CommunicationsListConversationInput = z.infer<typeof communicationsListConversationInputSchema>;

export interface CommunicationsListConversationOutput {
  messages: Array<{ direction: string; status: string; bodyPreview: string | null; createdAt: string }>;
}

export const communicationsListConversationTool: ToolImplementation<CommunicationsListConversationInput, CommunicationsListConversationOutput> = {
  toolKey: "communications.list_conversation",
  version: 1,
  inputSchema: communicationsListConversationInputSchema,
  execute: async (ctx, input) => {
    const execution = await resolveExecutionById(ctx.db, ctx.organizationId, ctx.executionId);
    const messages = await listMessagesForConversation(ctx.db, { organizationId: ctx.organizationId, conversationId: input.conversationId, actorUserId: execution.ownerUserId });
    const bounded = messages.slice(-input.limit);
    return {
      messages: bounded.map((m) => ({
        direction: m.direction,
        status: m.status,
        bodyPreview: m.bodyText ? m.bodyText.slice(0, MAX_BODY_PREVIEW) : null,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  },
};
