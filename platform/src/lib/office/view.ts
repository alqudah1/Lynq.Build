import "server-only";

import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { computeExecutiveAgentsView } from "@/lib/founder-os/agents-view";
import { listExecutionsForUser, type AgentExecution, type AgentExecutionStatus } from "@/lib/agent-runtime/executions";
import type { Agent, AgentDepartment } from "@/lib/agents/agents";

type Db = NeonHttpDatabase<Record<string, unknown>>;

const ACTIVE_EXECUTION_STATUSES = new Set<AgentExecutionStatus>([
  "gathering_context",
  "planning",
  "reasoning",
  "waiting",
  "executing",
  "delegating",
  "human_approval",
  "verifying",
]);

const ROLE_BY_AGENT_NAME: Record<string, { title: string; room: string; monogram: string }> = {
  "Product Delivery Lead": { title: "Product Delivery Lead", room: "Product Office", monogram: "PD" },
  "Software Engineering Lead": { title: "Software Engineering Lead", room: "Engineering Lab", monogram: "EN" },
  "Quality Assurance Lead": { title: "Quality Assurance Lead", room: "Quality Lab", monogram: "QA" },
  "Founder Analyst": { title: "Chief Executive Officer", room: "Executive Office", monogram: "CEO" },
  "Company Knowledge Analyst": { title: "Chief Operating Officer", room: "Operations Office", monogram: "COO" },
  "Communications Assistant": { title: "Executive Assistant", room: "Front Office", monogram: "EA" },
  "Campaign Brief Assistant": { title: "Marketing Director", room: "Marketing Studio", monogram: "MKT" },
  "Campaign Summary Assistant": { title: "Growth & Analytics Lead", room: "Growth Lab", monogram: "GR" },
  "Lead Research Assistant": { title: "Sales Director", room: "Sales Office", monogram: "SLS" },
  "Opportunity Summary Assistant": { title: "CRM Manager", room: "Client Relations", monogram: "CRM" },
  "Content Draft Assistant": { title: "Creative Director", room: "Creative Studio", monogram: "CD" },
};

const ROLE_BY_DEPARTMENT: Record<AgentDepartment, { title: string; room: string; monogram: string }> = {
  founders_office: { title: "Executive Team", room: "Executive Office", monogram: "EX" },
  product: { title: "Product Lead", room: "Product Office", monogram: "PD" },
  design: { title: "Design Lead", room: "Design Studio", monogram: "DS" },
  engineering: { title: "Engineering Lead", room: "Engineering Lab", monogram: "EN" },
  ai_systems: { title: "AI Systems Lead", room: "AI Lab", monogram: "AI" },
  client_success: { title: "Client Success Lead", room: "Client Office", monogram: "CS" },
  sales_and_bizdev: { title: "Sales & Partnerships", room: "Sales Office", monogram: "SP" },
  marketing_and_brand: { title: "Marketing & Brand", room: "Marketing Studio", monogram: "MB" },
  support: { title: "Support Lead", room: "Support Desk", monogram: "SU" },
  finance_and_operations: { title: "Operations Lead", room: "Operations Office", monogram: "OP" },
  legal_and_compliance: { title: "Compliance Lead", room: "Compliance Office", monogram: "LC" },
  security_and_trust: { title: "Security Lead", room: "Trust Center", monogram: "ST" },
  research_and_strategy: { title: "Strategy Lead", room: "Strategy Room", monogram: "RS" },
};

export interface OfficeAgentProfile {
  id: string;
  registryName: string;
  title: string;
  room: string;
  monogram: string;
  department: AgentDepartment;
  purpose: string;
  presence: "working" | "ready" | "attention" | "offline";
  presenceLabel: string;
  activeAssignmentCount: number;
  completedCount: number;
  successRate: number | null;
  recentArtifactCount: number;
  currentAssignment: string | null;
  lastUpdatedAt: string;
}

export interface OfficeActivityItem {
  id: string;
  agentId: string | null;
  agentName: string;
  title: string;
  status: AgentExecutionStatus;
  updatedAt: string;
}

export interface OfficeView {
  employees: OfficeAgentProfile[];
  recentActivity: OfficeActivityItem[];
  activeAssignmentCount: number;
  completedThisPeriod: number;
  assistantAgentId: string | null;
}

export function getAgentOfficeIdentity(agent: Pick<Agent, "name" | "department">) {
  return ROLE_BY_AGENT_NAME[agent.name] ?? ROLE_BY_DEPARTMENT[agent.department];
}

function presenceFor(agent: Agent, active: AgentExecution[]): Pick<OfficeAgentProfile, "presence" | "presenceLabel"> {
  if (agent.lifecycleStage === "retired" || agent.healthStatus === "unhealthy") {
    return { presence: "offline", presenceLabel: "Offline" };
  }
  if (agent.healthStatus === "degraded") {
    return { presence: "attention", presenceLabel: "Needs attention" };
  }
  if (active.length > 0) {
    const waiting = active.every((execution) => execution.status === "waiting" || execution.status === "human_approval");
    return waiting ? { presence: "attention", presenceLabel: "Waiting on you" } : { presence: "working", presenceLabel: "Working" };
  }
  return { presence: "ready", presenceLabel: "Ready" };
}

export async function loadOfficeView(
  db: Db,
  input: { organizationId: string; actorUserId: string }
): Promise<OfficeView> {
  const [workforce, executionPage] = await Promise.all([
    computeExecutiveAgentsView(db, { organizationId: input.organizationId, actorUserId: input.actorUserId }),
    listExecutionsForUser(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, limit: 100 }),
  ]);

  const executions = executionPage.executions;
  const agentNameById = new Map(workforce.agents.map((row) => [row.agent.id, row.agent.name]));

  const employees = workforce.agents.map((row): OfficeAgentProfile => {
    const identity = getAgentOfficeIdentity(row.agent);
    const assigned = executions.filter((execution) => execution.assignedAgentId === row.agent.id);
    const active = assigned.filter((execution) => ACTIVE_EXECUTION_STATUSES.has(execution.status) || execution.status === "assigned" || execution.status === "queued");
    const current = active[0] ?? assigned[0] ?? null;
    const presence = presenceFor(row.agent, active);

    return {
      id: row.agent.id,
      registryName: row.agent.name,
      title: identity.title,
      room: identity.room,
      monogram: identity.monogram,
      department: row.agent.department,
      purpose: row.agent.purpose,
      ...presence,
      activeAssignmentCount: active.length,
      completedCount: row.completed,
      successRate: row.successRate,
      recentArtifactCount: row.recentArtifactCount,
      currentAssignment: current?.goal ?? null,
      lastUpdatedAt: (current?.updatedAt ?? row.agent.updatedAt).toISOString(),
    };
  });

  employees.sort((a, b) => {
    const order = ["Executive Assistant", "Chief Executive Officer", "Chief Operating Officer"];
    const aIndex = order.indexOf(a.title);
    const bIndex = order.indexOf(b.title);
    if (aIndex !== -1 || bIndex !== -1) return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
    return a.title.localeCompare(b.title);
  });

  const recentActivity = executions.slice(0, 8).map((execution): OfficeActivityItem => ({
    id: execution.id,
    agentId: execution.assignedAgentId,
    agentName: execution.assignedAgentId ? (agentNameById.get(execution.assignedAgentId) ?? "Unassigned employee") : "Unassigned employee",
    title: execution.goal,
    status: execution.status,
    updatedAt: execution.updatedAt.toISOString(),
  }));

  return {
    employees,
    recentActivity,
    activeAssignmentCount: employees.reduce((sum, employee) => sum + employee.activeAssignmentCount, 0),
    completedThisPeriod: employees.reduce((sum, employee) => sum + employee.completedCount, 0),
    assistantAgentId: employees.find((employee) => employee.title === "Executive Assistant")?.id ?? null,
  };
}
