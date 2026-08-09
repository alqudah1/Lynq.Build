import "server-only";
import { randomUUID } from "node:crypto";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { requireAgentBrainCreateAccess } from "@/lib/brain/authz";
import { recordAuditEvent } from "@/lib/audit";
import type { KnowledgeDomain, KnowledgeItem } from "@/lib/brain/knowledge-items";
import type { AgentPrincipal } from "./authentication";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type RawSql = NeonQueryFunction<false, false>;

/**
 * ============================================================================
 * Agent draft creation — Brain Module 17's one bounded write path
 * ============================================================================
 *
 * AGENT_FRAMEWORK's ceiling, restated precisely: "Agents may create drafts
 * only." This file is the SMALLEST operation that proves real, unambiguous
 * agent attribution end-to-end (a real `knowledge_items` row with
 * `author_agent_id` set, a real `knowledge_item_versions` row with
 * `created_by_agent_id` set, a real audit event with `actor_agent_id`
 * set) — not the start of a full Agent Draft API. There is no
 * `updateDraftKnowledgeItemAsAgent`, no agent-facing archive/approve/
 * publish path, and none should be added here; those remain exclusively
 * human operations, exactly as `MODULE_3_BRAIN_ARCHITECTURE.md` §4 and
 * AGENT_FRAMEWORK's Human Approval Model (§8) require. An agent's only
 * way to change its own mind about a draft it created is to create a
 * fresh one — identical in spirit to how a human's `updateKnowledgeItem`
 * itself never rewrites history, only ever adds a new version.
 *
 * Authorization is the identical Brain Module 7 capability model, gated
 * through `requireAgentBrainCreateAccess` (`draft_write`, exact-scope-
 * match) — never the agent's `permissionLevel`/`department`, matching the
 * same rule Module 16's read path already enforces.
 */

export interface CreateDraftKnowledgeItemAsAgentInput {
  workspaceId?: string | null;
  domain: KnowledgeDomain;
  classification: string;
  title: string;
  content: string;
}

/**
 * Mirrors `createKnowledgeItem`'s exact atomic 3-statement shape (item +
 * v1 version + current-version pointer, one transaction) — NOT a call to
 * `createKnowledgeItem` itself, because that function's insert targets
 * `author_user_id`/`knowledge_item_versions.created_by_user_id`, columns
 * an agent id cannot legally populate (the `at_most_one_author`/
 * `at_most_one_creator` CHECK constraints would reject an agent id
 * written into a `*_user_id` column, and correctly so — an agent must
 * never be represented as a user). A small, deliberate, documented
 * duplication of the insert shape rather than widening `createKnowledgeItem`
 * itself and touching Brain Modules 1/2's already-shipped, heavily-tested
 * human creation path for a concern only this one agent-facing function has.
 */
export async function createDraftKnowledgeItemAsAgent(db: Db, rawSql: RawSql, principal: AgentPrincipal, input: CreateDraftKnowledgeItemAsAgentInput): Promise<KnowledgeItem> {
  const workspaceId = input.workspaceId ?? null;
  await requireAgentBrainCreateAccess(db, { organizationId: principal.organizationId, workspaceId, domain: input.domain, classification: input.classification }, principal.agentId);

  const itemId = randomUUID();
  const versionId = randomUUID();
  const now = new Date();

  await rawSql.transaction([
    rawSql`INSERT INTO knowledge_items (id, organization_id, workspace_id, domain, status, author_agent_id, author_type, created_at, updated_at)
           VALUES (${itemId}, ${principal.organizationId}, ${workspaceId}, ${input.domain}::knowledge_domain, 'draft'::knowledge_item_status, ${principal.agentId}, 'agent'::access_actor_type, ${now}, ${now})`,
    rawSql`INSERT INTO knowledge_item_versions (id, knowledge_item_id, version_number, title, content, classification, created_by_agent_id, created_by_type, change_reason, created_at)
           VALUES (${versionId}, ${itemId}, 1, ${input.title}, ${input.content}, ${input.classification}, ${principal.agentId}, 'agent'::access_actor_type, NULL, ${now})`,
    rawSql`UPDATE knowledge_items SET current_version_id = ${versionId} WHERE id = ${itemId}`,
  ]);

  await recordAuditEvent(db, {
    eventType: "knowledge_item_created",
    actorAgentId: principal.agentId,
    organizationId: principal.organizationId,
    targetType: "knowledge_item",
    targetId: itemId,
    metadata: { domain: input.domain, classification: input.classification, workspaceScoped: Boolean(workspaceId), createdByAgentVersion: true },
  });

  // Constructed directly, exactly like `createKnowledgeItem`'s own return
  // — deliberately NOT re-fetched via `getKnowledgeItemForAgent`, which
  // requires the `read` capability. `draft_write` and `read` are
  // independently-grantable capabilities (Brain Module 7); an agent
  // holding only `draft_write` must still get back the item it just
  // created, exactly as a human with only `draft_write` does today.
  return {
    id: itemId,
    organizationId: principal.organizationId,
    workspaceId,
    domain: input.domain,
    classification: input.classification,
    title: input.title,
    content: input.content,
    status: "draft",
    authorUserId: null,
    authorAgentId: principal.agentId,
    authorType: "agent",
    currentVersionNumber: 1,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    approvedByUserId: null,
    approvedAt: null,
    publishedByUserId: null,
    publishedAt: null,
    retiredByUserId: null,
    retiredAt: null,
    retiredReason: null,
    outcome: "pending",
  };
}
