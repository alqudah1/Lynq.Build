import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { registerTool, getCurrentToolVersion } from "@/lib/tools/definitions";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Communications OS Tool Runtime registration — Module 16
 * ============================================================================
 * Four narrow tools, reusing the exact `tool_definitions`/`registerTool`
 * mechanism Module 8 already built (the `"communication"` tool category
 * already existed in the schema, unused until now) — never a second tool
 * registry. Idempotent, mirroring `seedInitialTools`'s own
 * check-then-register shape.
 */
export async function seedCommunicationsTools(db: Db): Promise<void> {
  if (!(await getCurrentToolVersion(db, "communications.create_draft"))) {
    await registerTool(db, {
      toolKey: "communications.create_draft",
      name: "Create Communication Draft",
      description: "Creates a canonical outbound message draft on a conversation — never sends it.",
      category: "communication",
      inputSchema: { conversationId: "uuid", channel: "email | sms | whatsapp", recipientReference: "string", subject: "string?", bodyText: "string", idempotencyKey: "string" },
      outputSchema: { messageId: "uuid", status: "string" },
      riskLevel: "low",
      sideEffectClass: "internal_write",
      requiredCapabilities: [],
      minimumPermissionLevel: "assistant",
      idempotencyRequired: true,
    });
  }

  if (!(await getCurrentToolVersion(db, "communications.send"))) {
    await registerTool(db, {
      toolKey: "communications.send",
      name: "Send Communication",
      description: "Enqueues an already-approved message for real provider dispatch. Never creates the approval itself — an unapproved message is rejected.",
      category: "communication",
      inputSchema: { messageId: "uuid" },
      outputSchema: { messageId: "uuid", status: "string" },
      riskLevel: "high",
      sideEffectClass: "external_write",
      requiredCapabilities: [],
      minimumPermissionLevel: "assistant",
      // Approval is enforced at the Communications OS domain layer (the
      // message must already be `approved`) — Tool Runtime's own
      // approval gate is deliberately NOT also enabled here, to avoid a
      // second, redundant approval system for the same action.
      approvalRequired: false,
      idempotencyRequired: true,
    });
  }

  if (!(await getCurrentToolVersion(db, "communications.get_status"))) {
    await registerTool(db, {
      toolKey: "communications.get_status",
      name: "Get Communication Status",
      description: "Reads a message's live canonical status.",
      category: "communication",
      inputSchema: { messageId: "uuid" },
      outputSchema: { messageId: "uuid", status: "string", providerMessageId: "string | null", failureClass: "string | null", sentAt: "string | null", deliveredAt: "string | null" },
      riskLevel: "low",
      sideEffectClass: "read_only",
      requiredCapabilities: [],
      minimumPermissionLevel: "observer",
      idempotencyRequired: false,
    });
  }

  if (!(await getCurrentToolVersion(db, "communications.list_conversation"))) {
    await registerTool(db, {
      toolKey: "communications.list_conversation",
      name: "List Conversation",
      description: "Reads a bounded, truncated preview of a conversation's recent messages — minimum context, never full history.",
      category: "communication",
      inputSchema: { conversationId: "uuid", limit: "number?" },
      outputSchema: { messages: "array" },
      riskLevel: "low",
      sideEffectClass: "read_only",
      requiredCapabilities: [],
      minimumPermissionLevel: "observer",
      idempotencyRequired: false,
    });
  }
}
