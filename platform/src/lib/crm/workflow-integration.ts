import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { workflowExecutions } from "@/db/schema";
import { startWorkflowExecution, type WorkflowExecution } from "@/lib/workflows/executions";
import { recordAuditEvent } from "@/lib/audit";
import { resolveContactById } from "./contacts";
import { resolveCompanyById } from "./companies";
import { resolveLeadById } from "./leads";
import { resolveOpportunityById } from "./opportunities";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface StartWorkflowWithCrmContextInput {
  organizationId: string;
  definitionId: string;
  projectId?: string | null;
  projectTaskId?: string | null;
  crmContactId?: string | null;
  crmCompanyId?: string | null;
  crmLeadId?: string | null;
  crmOpportunityId?: string | null;
  input?: Record<string, unknown>;
  actorUserId: string;
}

/**
 * Starts a workflow execution carrying CRM record references — trusted
 * IDs only, resolved tenant-safely up front (a cross-tenant or
 * nonexistent id throws `TenantResourceNotFoundError` before any
 * execution is created), never a copy of the full CRM record. The IDs
 * land in the execution's own bounded `input` JSON under reserved keys
 * (`crmContactId`/`crmCompanyId`/`crmLeadId`/`crmOpportunityId`), exactly
 * where the Workflow Engine's existing `workflow_input` mapping source
 * already reads from — no new mapping-source kind, no CRM automation
 * trigger, and no modification to `startWorkflowExecution` itself.
 */
export async function startWorkflowWithCrmContext(db: Db, input: StartWorkflowWithCrmContextInput): Promise<WorkflowExecution> {
  const crmRefs: Record<string, string> = {};

  if (input.crmContactId) {
    await resolveContactById(db, input.organizationId, input.crmContactId);
    crmRefs.crmContactId = input.crmContactId;
  }
  if (input.crmCompanyId) {
    await resolveCompanyById(db, input.organizationId, input.crmCompanyId);
    crmRefs.crmCompanyId = input.crmCompanyId;
  }
  if (input.crmLeadId) {
    await resolveLeadById(db, input.organizationId, input.crmLeadId);
    crmRefs.crmLeadId = input.crmLeadId;
  }
  if (input.crmOpportunityId) {
    await resolveOpportunityById(db, input.organizationId, input.crmOpportunityId);
    crmRefs.crmOpportunityId = input.crmOpportunityId;
  }

  const execution = await startWorkflowExecution(db, {
    organizationId: input.organizationId,
    definitionId: input.definitionId,
    projectId: input.projectId ?? null,
    projectTaskId: input.projectTaskId ?? null,
    input: { ...(input.input ?? {}), ...crmRefs },
    actorUserId: input.actorUserId,
  });

  if (Object.keys(crmRefs).length > 0) {
    await recordAuditEvent(db, { eventType: "crm_workflow_execution_started", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "workflow_execution", targetId: execution.id, metadata: { ...crmRefs, definitionId: input.definitionId } });
  }

  return execution;
}

/** Lists workflow executions whose bounded `input` references this CRM entity — a plain JSONB lookup on the reserved `crm*Id` key, never a duplicated index of its own. */
export async function listWorkflowExecutionsForCrmEntity(db: Db, input: { organizationId: string; crmEntityKey: "crmContactId" | "crmCompanyId" | "crmLeadId" | "crmOpportunityId"; crmEntityId: string }): Promise<WorkflowExecution[]> {
  const rows = await db
    .select()
    .from(workflowExecutions)
    .where(and(eq(workflowExecutions.organizationId, input.organizationId), sql`${workflowExecutions.input} ->> ${input.crmEntityKey} = ${input.crmEntityId}`));
  return rows as unknown as WorkflowExecution[];
}
