import "server-only";

import { generateText, Output } from "ai";
import { z } from "zod";
import type { Agent } from "@/lib/agents/agents";
import type { KnowledgeDomain } from "@/lib/brain/knowledge-items";
import { getAgentOfficeIdentity } from "./view";

const officePlanSchema = z.object({
  projectName: z.string().trim().min(1).max(200),
  objective: z.string().trim().min(1).max(2000),
  assistantReply: z.string().trim().min(1).max(1000),
  assignments: z
    .array(
      z.object({
        agentId: z.string().uuid(),
        title: z.string().trim().min(1).max(300),
        goal: z.string().trim().min(1).max(2000),
        successCriteria: z.string().trim().min(1).max(2000),
        handoff: z.string().trim().max(500),
      })
    )
    .min(1)
    .max(8),
});

export type OfficeDirectivePlan = z.infer<typeof officePlanSchema> & { plannedByAI: boolean };

function domainsForAgent(agent: Agent): KnowledgeDomain[] {
  switch (agent.department) {
    case "marketing_and_brand":
      return ["identity", "market", "growth"];
    case "sales_and_bizdev":
    case "client_success":
      return ["market", "offerings", "growth"];
    case "finance_and_operations":
      return ["execution", "governance"];
    case "research_and_strategy":
    case "founders_office":
      return ["identity", "market", "execution"];
    case "design":
    case "product":
    case "engineering":
    case "ai_systems":
      return ["offerings", "execution", "capability"];
    case "legal_and_compliance":
    case "security_and_trust":
      return ["governance", "capability"];
    default:
      return ["identity", "execution"];
  }
}

function chooseFallbackAgents(instruction: string, agents: Agent[], preferredAgentId?: string | null): Agent[] {
  if (preferredAgentId) {
    const preferred = agents.find((agent) => agent.id === preferredAgentId);
    if (preferred) return [preferred];
  }

  const lowered = instruction.toLowerCase();
  const wantedTitles = new Set<string>(["Chief Executive Officer", "Chief Operating Officer"]);
  if (/web|digital|brand|content|campaign|marketing|social|seo/.test(lowered)) {
    wantedTitles.add("Marketing Director");
    wantedTitles.add("Creative Director");
  }
  if (/lead|sale|customer|client|crm|pipeline|revenue/.test(lowered)) {
    wantedTitles.add("Sales Director");
    wantedTitles.add("CRM Manager");
  }
  if (/research|market|competitor|strategy|transform/.test(lowered)) {
    wantedTitles.add("Growth & Analytics Lead");
  }

  const selected = agents.filter((agent) => wantedTitles.has(getAgentOfficeIdentity(agent).title));
  return (selected.length > 0 ? selected : agents.filter((agent) => getAgentOfficeIdentity(agent).title !== "Executive Assistant")).slice(0, 6);
}

export function deriveDirectiveProjectName(instruction: string): string {
  const signed = instruction.match(/\bsigned\s+(?:a\s+|an\s+|the\s+)?([A-Za-z][A-Za-z0-9&'-]{1,60})/i)?.[1]?.trim();
  if (signed) return signed;
  const named = instruction.match(/(?:project|client|company|business)\s+(?:for|called|named)\s+([A-Za-z0-9][A-Za-z0-9 .&'-]{1,60}?)(?:\s+to\s+|[,.]|$)/i)?.[1]?.trim();
  if (named) return named;
  const words = instruction.replace(/[^A-Za-z0-9 '&-]/g, " ").trim().split(/\s+/).slice(0, 6);
  return words.length > 0 ? words.join(" ") : "Founder Directive";
}

function fallbackPlan(instruction: string, agents: Agent[], preferredAgentId?: string | null): OfficeDirectivePlan {
  const selected = chooseFallbackAgents(instruction, agents, preferredAgentId);
  const assignments = selected.map((agent, index) => {
    const identity = getAgentOfficeIdentity(agent);
    return {
      agentId: agent.id,
      title: `${identity.title}: ${index === 0 ? "lead the initial brief" : "deliver the assigned workstream"}`,
      goal: `${identity.title} will contribute to this founder directive: ${instruction}`.slice(0, 2000),
      successCriteria: `Produce a clear, reviewable ${identity.title.toLowerCase()} deliverable with assumptions, decisions, and next actions documented.`,
      handoff: index === selected.length - 1 ? "Return the completed workstream to the Executive Assistant for founder review." : `Share conclusions with ${getAgentOfficeIdentity(selected[index + 1]).title}.`,
    };
  });

  return {
    projectName: deriveDirectiveProjectName(instruction),
    objective: instruction,
    assistantReply: `I opened the project and briefed ${assignments.length} employee${assignments.length === 1 ? "" : "s"}. Their workstreams are ready in the office.`,
    assignments,
    plannedByAI: false,
  };
}

export async function planOfficeDirective(input: {
  instruction: string;
  agents: Agent[];
  preferredAgentId?: string | null;
}): Promise<OfficeDirectivePlan> {
  const eligibleAgents = input.agents.filter((agent) => agent.lifecycleStage !== "retired");
  if (eligibleAgents.length === 0) throw new Error("No eligible agents are available");

  const fallback = fallbackPlan(input.instruction, eligibleAgents, input.preferredAgentId);
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) return fallback;

  const roster = eligibleAgents.map((agent) => {
    const identity = getAgentOfficeIdentity(agent);
    return {
      agentId: agent.id,
      title: identity.title,
      registryName: agent.name,
      purpose: agent.purpose,
      department: agent.department,
    };
  });

  try {
    const result = await generateText({
      model: "openai/gpt-5.6-sol",
      output: Output.object({ name: "OfficeDirectivePlan", schema: officePlanSchema }),
      system:
        "You are the LYNQ Executive Assistant. Convert a founder directive into a concise, executable company project. Select only agents from the supplied roster and copy their agentId exactly. Give each selected employee one distinct workstream. Include explicit handoffs so employees know who receives their output. Do not claim work is complete, do not invent employees, and do not schedule external actions or spending. Keep the founder-facing reply direct and confident.",
      prompt: JSON.stringify({
        founderDirective: input.instruction,
        preferredAgentId: input.preferredAgentId ?? null,
        roster,
      }),
    });

    const validIds = new Set(eligibleAgents.map((agent) => agent.id));
    const parsed = officePlanSchema.parse(result.output);
    const assignments = parsed.assignments.filter((assignment) => validIds.has(assignment.agentId));
    if (assignments.length === 0) return fallback;
    if (input.preferredAgentId && !assignments.some((assignment) => assignment.agentId === input.preferredAgentId)) return fallback;
    return { ...parsed, assignments, plannedByAI: true };
  } catch {
    return fallback;
  }
}

export function getDirectiveDomains(agent: Agent): KnowledgeDomain[] {
  return domainsForAgent(agent);
}
