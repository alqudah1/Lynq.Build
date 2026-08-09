import "server-only";

import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agents } from "@/db/schema";
import { registerAgent, resolveAgentById, type Agent } from "@/lib/agents/agents";
import { advanceAgentLifecycleStage, changeAgentPermissionLevel } from "@/lib/agents/lifecycle";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export const OFFICE_PRODUCT_AGENT_NAME = "Product Delivery Lead";
export const OFFICE_ENGINEERING_AGENT_NAME = "Software Engineering Lead";
export const OFFICE_QA_AGENT_NAME = "Quality Assurance Lead";

type SeedDefinition = {
  name: string;
  department: "product" | "engineering";
  purpose: string;
  responsibilities: string;
  inputs: string;
  outputs: string;
  successCriteria: string;
  failureCriteria: string;
};

const DELIVERY_TEAM: SeedDefinition[] = [
  {
    name: OFFICE_PRODUCT_AGENT_NAME,
    department: "product",
    purpose: "Turn a founder objective into a build-ready product brief grounded in the project evidence available to LYNQ.",
    responsibilities: "Clarify the user, outcome, scope, acceptance criteria, constraints, dependencies, and risks; create a concise handoff that Engineering can execute without inventing requirements.",
    inputs: "Founder directive, project objective, and prior project artifacts.",
    outputs: "A product brief artifact with scope, decisions, acceptance criteria, risks, and an Engineering handoff.",
    successCriteria: "Engineering receives a concrete, bounded specification with testable acceptance criteria.",
    failureCriteria: "Required founder decisions or evidence are missing and proceeding would require inventing material requirements.",
  },
  {
    name: OFFICE_ENGINEERING_AGENT_NAME,
    department: "engineering",
    purpose: "Implement approved project objectives in an isolated workspace and return reviewable source control evidence.",
    responsibilities: "Inspect the approved repository, create a feature branch, edit code in Vercel Sandbox, run relevant checks, commit, push, and open a pull request; never merge or deploy production.",
    inputs: "Founder directive, product brief, approved repository, base branch, and project artifacts.",
    outputs: "A feature branch, commit, pull request, validation log, and implementation report.",
    successCriteria: "A reviewable pull request exists and the relevant automated checks pass or every unresolved failure is reported honestly.",
    failureCriteria: "Repository authorization, sandbox isolation, validation, or safe branch creation cannot be proven.",
  },
  {
    name: OFFICE_QA_AGENT_NAME,
    department: "engineering",
    purpose: "Independently verify Office-built changes and return a founder-ready preview decision.",
    responsibilities: "Review the pull request evidence, checks, and preview deployment; compare the implementation with acceptance criteria; report defects and request founder approval without merging or deploying production.",
    inputs: "Product brief, pull request, commit checks, preview URL, validation output, and acceptance criteria.",
    outputs: "A QA report and a founder approval request linked to the project.",
    successCriteria: "The founder receives a working preview URL, test evidence, known risks, and a clear approve or request-changes decision.",
    failureCriteria: "A preview or required validation evidence is unavailable, or acceptance criteria are not met.",
  },
];

async function ensureOne(db: Db, input: { organizationId: string; humanOwnerUserId: string; actorUserId: string; definition: SeedDefinition }): Promise<Agent> {
  const [existing] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.organizationId, input.organizationId), eq(agents.name, input.definition.name)));
  if (existing) return (await resolveAgentById(db, existing.id))!;

  const agent = await registerAgent(db, {
    organizationId: input.organizationId,
    humanOwnerUserId: input.humanOwnerUserId,
    actorUserId: input.actorUserId,
    permissionLevel: "assistant",
    goals: input.definition.successCriteria,
    retirementCriteria: "Retire when this delivery function is replaced by a reviewed successor with equal or stronger safety boundaries.",
    ...input.definition,
  });
  for (const toStage of ["specification", "development", "testing", "approval", "deployment"] as const) {
    await advanceAgentLifecycleStage(db, { organizationId: input.organizationId, agentId: agent.id, toStage, actorUserId: input.actorUserId });
  }
  await changeAgentPermissionLevel(db, {
    organizationId: input.organizationId,
    agentId: agent.id,
    newPermissionLevel: "assistant",
    reason: "Office Delivery V1 uses the minimum level required to create artifacts and feature-branch work; production actions remain human-gated.",
    actorUserId: input.actorUserId,
  });
  return (await resolveAgentById(db, agent.id))!;
}

export async function ensureOfficeDeliveryTeam(db: Db, input: { organizationId: string; humanOwnerUserId: string; actorUserId: string }): Promise<Agent[]> {
  return Promise.all(DELIVERY_TEAM.map((definition) => ensureOne(db, { ...input, definition })));
}
