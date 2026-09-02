import "server-only";

import { generateText, Output } from "ai";
import { z } from "zod";
import type { Agent } from "@/lib/agents/agents";
import type { KnowledgeDomain } from "@/lib/brain/knowledge-items";
import { getAgentOfficeIdentity } from "./view";
import { getOfficeModel } from "./models";
import { officeDeliveryStageSchema } from "./task-metadata";
import { OFFICE_ENGINEERING_AGENT_NAME, OFFICE_PRODUCT_AGENT_NAME, OFFICE_QA_AGENT_NAME } from "./team";

const officePlanSchema = z.object({
  executionMode: z.enum(["delivery", "advisory"]),
  sequentialHandoffs: z.boolean(),
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
        stage: officeDeliveryStageSchema,
      })
    )
    .min(1)
    .max(12),
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

const COMPANY_HANDOFF_ROLES = [
  "Executive Assistant",
  "Chief Executive Officer",
  "Chief Operating Officer",
  "Marketing Director",
  "Sales Director",
  "CRM Manager",
  "Creative Director",
  "Growth & Analytics Lead",
] as const;

const COMPANY_HANDOFF_DELIVERABLES: Record<(typeof COMPANY_HANDOFF_ROLES)[number], { title: string; successCriteria: string }> = {
  "Executive Assistant": {
    title: "Capture the founder brief and coordinate the company handoff",
    successCriteria: "The founder objective, open questions, decisions required, and the next executive handoff are recorded in a concise kickoff brief.",
  },
  "Chief Executive Officer": {
    title: "Set the company outcome and strategic guardrails",
    successCriteria: "A clear outcome, priorities, non-goals, decision guardrails, and leadership direction are documented for the project.",
  },
  "Chief Operating Officer": {
    title: "Turn the strategy into an accountable operating plan",
    successCriteria: "A sequenced operating plan identifies owners, dependencies, risks, milestones, and the next department handoff.",
  },
  "Marketing Director": {
    title: "Define the market position and campaign requirements",
    successCriteria: "A positioning, audience, message, channel, and campaign brief is ready for the commercial and creative teams.",
  },
  "Sales Director": {
    title: "Define the offer, sales motion, and conversion requirements",
    successCriteria: "The offer, qualification path, sales messaging, handoff requirements, and conversion assumptions are documented.",
  },
  "CRM Manager": {
    title: "Define CRM lifecycle, attribution, and follow-up requirements",
    successCriteria: "Required CRM fields, source attribution, lifecycle stages, automations, and reporting requirements are documented.",
  },
  "Creative Director": {
    title: "Create the creative direction and production brief",
    successCriteria: "A brand-aligned creative brief defines the required assets, tone, formats, review criteria, and production dependencies.",
  },
  "Growth & Analytics Lead": {
    title: "Define measurement, experiments, and the founder scorecard",
    successCriteria: "Success metrics, tracked links, reporting cadence, experiment hypotheses, and a founder-ready scorecard are specified.",
  },
};

function needsSoftwareDelivery(instruction: string): boolean {
  return /\b(build|create|develop|implement|code|application|app|website|platform|software|mvp|redesign|digital(?:ly)? transform)\b/i.test(instruction);
}

export function isRestaurantProspectingDirective(instruction: string): boolean {
  return /\brestaurant\b/i.test(instruction) && /\b(find|research|choose|select|prospect|outreach)\b/i.test(instruction) && /\b(build|create|demo|website|redesign)\b/i.test(instruction);
}

function restaurantProspectingPlan(instruction: string, agents: Agent[]): OfficeDirectivePlan | null {
  const byTitle = new Map(agents.map((agent) => [getAgentOfficeIdentity(agent).title, agent]));
  const researchAgent = byTitle.get("Growth & Analytics Lead") ?? byTitle.get("Sales Director");
  const productAgent = agents.find((agent) => agent.name === OFFICE_PRODUCT_AGENT_NAME);
  const engineeringAgent = agents.find((agent) => agent.name === OFFICE_ENGINEERING_AGENT_NAME);
  const qaAgent = agents.find((agent) => agent.name === OFFICE_QA_AGENT_NAME);
  if (!researchAgent || !productAgent || !engineeringAgent || !qaAgent) return null;

  const assignments: Array<{ agent: Agent; stage: "research" | "product" | "engineering" | "qa" | "outreach"; title: string; goal: string; successCriteria: string; handoff: string }> = [
    {
      agent: researchAgent,
      stage: "research" as const,
      title: "Research real restaurant prospects and recommend one with public evidence",
      goal: `Find real restaurant prospects for this founder directive, compare them using current public evidence, and recommend exactly one before any build or outreach begins: ${instruction}`,
      successCriteria: "One recommended restaurant and at least one alternative are documented with verifiable URLs, observed website problems, public contact details only when verified, and a founder approval request.",
      handoff: "After founder approval, hand the selected restaurant and cited evidence to Product Delivery.",
    },
    {
      agent: productAgent,
      stage: "product" as const,
      title: "Turn the approved restaurant opportunity into a bounded demo brief",
      goal: `Use only the founder-approved restaurant research to define a truthful website demo for: ${instruction}`,
      successCriteria: "A bounded demo brief identifies the user journey, page scope, conversion goal, content assumptions, asset restrictions, and testable acceptance criteria without pretending to represent the restaurant.",
      handoff: "Hand the approved evidence and demo brief to Engineering.",
    },
    {
      agent: engineeringAgent,
      stage: "engineering" as const,
      title: "Build the approved restaurant demo in an isolated branch",
      goal: `Build the bounded restaurant website demo defined by Product for: ${instruction}`,
      successCriteria: "A reviewable feature-branch pull request and Vercel preview exist, with validation evidence and a visible demo disclaimer.",
      handoff: "Hand the pull request, preview, checks, and source evidence to Quality Assurance.",
    },
    {
      agent: qaAgent,
      stage: "qa" as const,
      title: "Verify the demo and return it for founder approval",
      goal: `Verify the restaurant demo against the approved research and product brief for: ${instruction}`,
      successCriteria: "The founder receives the working preview, validation results, known limitations, and an approval gate before any outreach is prepared or sent.",
      handoff: "Return the verified demo to the founder. Outreach remains blocked until a separately approved communication is ready.",
    },
  ];
  if (/\b(outreach|contact|email|send)\b/i.test(instruction)) {
    const outreachAgent = byTitle.get("CRM Manager") ?? byTitle.get("Sales Director") ?? byTitle.get("Executive Assistant");
    if (outreachAgent) {
      assignments.push({
        agent: outreachAgent,
        stage: "outreach",
        title: "Prepare the evidence-backed outreach and wait for founder approval",
        goal: `Use the approved prospect and verified demo preview to prepare one truthful first-contact email for: ${instruction}`,
        successCriteria: "One message is addressed only to a verified public business email, references the real preview, makes no false claims, and is blocked by a founder approval before provider dispatch.",
        handoff: "After founder approval, queue exactly one provider message and report its real delivery state.",
      });
      assignments[assignments.length - 2].handoff = "After founder approval of the verified demo, hand the selected prospect, preview, and limitations to CRM for a separately approved outreach message.";
    }
  }

  return {
    executionMode: "delivery",
    sequentialHandoffs: true,
    projectName: deriveDirectiveProjectName(instruction),
    objective: instruction,
    assistantReply: assignments.some((assignment) => assignment.stage === "outreach")
      ? "I started the restaurant outreach pipeline. Jarvis will research real prospects with public sources, ask you to approve one, build and verify the demo, then show you the exact outreach message before one provider send is queued."
      : "I started the restaurant demo pipeline. Jarvis will research real prospects with public sources and ask you to approve one before Product or Engineering begins. The finished preview returns to you again before any outreach.",
    plannedByAI: false,
    assignments: assignments.map(({ agent, ...assignment }) => ({ ...assignment, agentId: agent.id })),
  };
}

function shouldRunCompanyHandoff(agents: Agent[], preferredAgentId?: string | null): boolean {
  if (!preferredAgentId) return true;
  const preferred = agents.find((agent) => agent.id === preferredAgentId);
  return preferred ? getAgentOfficeIdentity(preferred).title === "Executive Assistant" : false;
}

function companyHandoffPlan(instruction: string, agents: Agent[]): OfficeDirectivePlan {
  const byTitle = new Map(agents.map((agent) => [getAgentOfficeIdentity(agent).title, agent]));
  const commercialChain = COMPANY_HANDOFF_ROLES
    .map((title) => {
      const agent = byTitle.get(title);
      return agent ? { agent, title } : null;
    })
    .filter((item): item is { agent: Agent; title: (typeof COMPANY_HANDOFF_ROLES)[number] } => Boolean(item));
  const delivery = needsSoftwareDelivery(instruction);
  const deliveryChain = delivery
    ? [
        { agent: agents.find((agent) => agent.name === OFFICE_PRODUCT_AGENT_NAME), stage: "product" as const, title: "Translate the company plan into build-ready product requirements", successCriteria: "A bounded product brief, acceptance criteria, and delivery scope are ready for Engineering." },
        { agent: agents.find((agent) => agent.name === OFFICE_ENGINEERING_AGENT_NAME), stage: "engineering" as const, title: "Implement the approved work in an isolated feature branch", successCriteria: "A feature-branch pull request exists with relevant validations and preview evidence." },
        { agent: agents.find((agent) => agent.name === OFFICE_QA_AGENT_NAME), stage: "qa" as const, title: "Verify the pull request and return it for founder approval", successCriteria: "The pull request, automated checks, and Vercel preview are reviewed and returned for founder approval." },
      ].filter((item): item is { agent: Agent; stage: "product" | "engineering" | "qa"; title: string; successCriteria: string } => Boolean(item.agent))
    : [];
  const chain = [
    ...commercialChain.map(({ agent, title }) => ({ agent, stage: "advisory" as const, title: COMPANY_HANDOFF_DELIVERABLES[title].title, successCriteria: COMPANY_HANDOFF_DELIVERABLES[title].successCriteria })),
    ...deliveryChain,
  ];
  if (chain.length === 0) return fallbackPlan(instruction, agents);

  return {
    executionMode: delivery ? "delivery" : "advisory",
    sequentialHandoffs: true,
    projectName: deriveDirectiveProjectName(instruction),
    objective: instruction,
    assistantReply: delivery
      ? "I opened one company project. The Executive Assistant will coordinate the CEO, COO, Marketing, Sales, CRM, Creative, and Growth handoffs before Product, Engineering, and QA take over. Every handoff stays attached to the same project, and the final build still returns to you for approval."
      : "I opened one company project. The Executive Assistant will coordinate the CEO, COO, Marketing, Sales, CRM, Creative, and Growth handoffs in order, with every decision and deliverable kept in the same project for your review.",
    plannedByAI: false,
    assignments: chain.map((item, index) => ({
      agentId: item.agent.id,
      title: `${getAgentOfficeIdentity(item.agent).title}: ${item.title}`,
      goal: `${getAgentOfficeIdentity(item.agent).title} owns this handoff for the founder directive: ${instruction}`.slice(0, 2000),
      successCriteria: item.successCriteria,
      handoff: index === chain.length - 1 ? "Return the complete project record to the Executive Assistant and founder for review." : `Share the completed deliverable and decisions with ${getAgentOfficeIdentity(chain[index + 1].agent).title}.`,
      stage: item.stage,
    })),
  };
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
  const softwareDelivery = !preferredAgentId && needsSoftwareDelivery(instruction);
  if (softwareDelivery) {
    const required = [OFFICE_PRODUCT_AGENT_NAME, OFFICE_ENGINEERING_AGENT_NAME, OFFICE_QA_AGENT_NAME]
      .map((name) => agents.find((agent) => agent.name === name))
      .filter((agent): agent is Agent => Boolean(agent));
    if (required.length === 3) {
      const stages = ["product", "engineering", "qa"] as const;
      const titles = ["Define the build-ready product brief", "Implement and validate the feature branch", "Verify the pull request and preview"];
      const handoffs = ["Hand the approved scope and acceptance criteria to Engineering.", "Hand the pull request, checks, and preview evidence to QA.", "Return the verified preview and approval decision to the founder."];
      return {
        executionMode: "delivery",
        sequentialHandoffs: true,
        projectName: deriveDirectiveProjectName(instruction),
        objective: instruction,
        assistantReply: "I opened the project and started the delivery chain. Product will define the scope, Engineering will build it in an isolated branch, and QA will return the preview for your approval.",
        plannedByAI: false,
        assignments: required.map((agent, index) => ({
          agentId: agent.id,
          title: titles[index],
          goal: `${getAgentOfficeIdentity(agent).title} will complete the ${stages[index]} stage for this founder directive: ${instruction}`.slice(0, 2000),
          successCriteria: index === 0 ? "A testable product brief and bounded acceptance criteria exist." : index === 1 ? "A feature-branch pull request exists with relevant validations executed." : "The pull request, automated checks, and Vercel preview are reviewed and returned for founder approval.",
          handoff: handoffs[index],
          stage: stages[index],
        })),
      };
    }
  }
  const selected = chooseFallbackAgents(instruction, agents, preferredAgentId);
  const assignments = selected.map((agent, index) => {
    const identity = getAgentOfficeIdentity(agent);
    return {
      agentId: agent.id,
      title: `${identity.title}: ${index === 0 ? "lead the initial brief" : "deliver the assigned workstream"}`,
      goal: `${identity.title} will contribute to this founder directive: ${instruction}`.slice(0, 2000),
      successCriteria: `Produce a clear, reviewable ${identity.title.toLowerCase()} deliverable with assumptions, decisions, and next actions documented.`,
      handoff: index === selected.length - 1 ? "Return the completed workstream to the Executive Assistant for founder review." : `Share conclusions with ${getAgentOfficeIdentity(selected[index + 1]).title}.`,
      stage: "advisory" as const,
    };
  });

  return {
    executionMode: "advisory",
    sequentialHandoffs: false,
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
  if (!input.preferredAgentId && isRestaurantProspectingDirective(input.instruction)) {
    return restaurantProspectingPlan(input.instruction, eligibleAgents) ?? fallback;
  }
  if (shouldRunCompanyHandoff(eligibleAgents, input.preferredAgentId)) {
    return companyHandoffPlan(input.instruction, eligibleAgents);
  }
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
      model: getOfficeModel("planning"),
      output: Output.object({ name: "OfficeDirectivePlan", schema: officePlanSchema }),
      system:
        "You are the LYNQ Executive Assistant. Convert a founder directive into a concise, executable company project. Select only agents from the supplied roster and copy their agentId exactly. Set sequentialHandoffs true whenever one employee must receive another's output; include explicit handoffs. For objectives that require creating or changing software, use executionMode delivery and ensure Product Delivery Lead (stage product), Software Engineering Lead (stage engineering), then Quality Assurance Lead (stage qa) appear in that order, after any advisory handoffs. For advice-only work, use executionMode advisory and stage advisory. Do not claim work is complete, invent employees, schedule spending, merge code, or change production. Keep the founder-facing reply direct and confident.",
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
    if (parsed.executionMode === "delivery") {
      const expected = ["product", "engineering", "qa"];
      const deliveryStages = assignments.filter((assignment) => assignment.stage !== "advisory").map((assignment) => assignment.stage);
      if (deliveryStages.length !== 3 || deliveryStages.some((stage, index) => stage !== expected[index])) return fallback;
    }
    if (input.preferredAgentId && !assignments.some((assignment) => assignment.agentId === input.preferredAgentId)) return fallback;
    return { ...parsed, assignments, plannedByAI: true };
  } catch {
    return fallback;
  }
}

export function getDirectiveDomains(agent: Agent): KnowledgeDomain[] {
  return domainsForAgent(agent);
}
