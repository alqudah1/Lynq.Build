import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { registerTool, getCurrentToolVersion, type ToolCategory, type ToolRiskLevel, type ToolSideEffectClass } from "@/lib/tools/definitions";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Lead-gen Tool Runtime registration
 * ============================================================================
 * The POLICY half of each tool — risk, permission floor, side-effect class,
 * approval — recorded in `tool_definitions`, the same table and the same
 * `registerTool` mechanism Modules 8 and 16 already use. Idempotent:
 * re-running only fills in tools that do not exist yet, never rewriting a
 * policy an operator has since tightened by hand.
 *
 * The permission floors encode the approval rules directly. Everything
 * Claude may do unattended — research, enrich, generate, review, draft,
 * batch, classify — sits at `assistant`. The three operations that reach a
 * real person or change a lead's commercial meaning sit at `operator`, and
 * the send path additionally cannot proceed without a human approval
 * decision recorded by the existing approval system.
 */

interface SeedEntry {
  toolKey: string;
  name: string;
  description: string;
  category: ToolCategory;
  inputSchema: Record<string, string>;
  outputSchema: Record<string, string>;
  riskLevel: ToolRiskLevel;
  sideEffectClass: ToolSideEffectClass;
  minimumPermissionLevel: "observer" | "assistant" | "operator" | "manager" | "executive" | "system";
  idempotencyRequired: boolean;
  approvalRequired?: boolean;
}

const SEED_ENTRIES: SeedEntry[] = [
  {
    toolKey: "leadgen.find_qualified_leads",
    name: "Find Qualified Leads",
    description: "Lists CRM leads with their market, score and demo outreach-eligibility. Read-only.",
    category: "data",
    inputSchema: { market: "JO | CA (optional)", status: "lead status (optional)", minimumScore: "0-100 (optional)", onlyOutreachEligible: "boolean", limit: "1-200" },
    outputSchema: { count: "number", leads: "lead summaries" },
    riskLevel: "low",
    sideEffectClass: "read_only",
    minimumPermissionLevel: "observer",
    idempotencyRequired: false,
  },
  {
    toolKey: "leadgen.get_lead",
    name: "Get Lead",
    description: "Reads one lead with its company, contact, market, price and demo review state. Read-only.",
    category: "data",
    inputSchema: { leadId: "uuid" },
    outputSchema: { lead: "lead summary" },
    riskLevel: "low",
    sideEffectClass: "read_only",
    minimumPermissionLevel: "observer",
    idempotencyRequired: false,
  },
  {
    toolKey: "leadgen.enrich_lead",
    name: "Enrich Lead",
    description: "Updates the descriptive business facts a demo is built from. Cannot change owner, lifecycle stage or any commercial field. Clears the demo review, since the facts it was made against have changed.",
    category: "data",
    inputSchema: { leadId: "uuid", expectedCompanyRevision: "number", category: "string?", city: "string?", countryCode: "JO | CA?", description: "string?", photoUrl: "https url?", website: "url|null?", rating: "0-5?", reviewCount: "int?", formattedAddress: "string?" },
    outputSchema: { companyId: "uuid", revision: "number", demoReviewCleared: "boolean" },
    riskLevel: "low",
    sideEffectClass: "internal_write",
    minimumPermissionLevel: "assistant",
    idempotencyRequired: true,
  },
  {
    toolKey: "leadgen.score_lead",
    name: "Score Lead",
    description: "Recomputes and stores the opportunity score from reputation, digital gap and contactability.",
    category: "data",
    inputSchema: { leadId: "uuid", expectedLeadRevision: "number", websiteScore: "0-100|null?" },
    outputSchema: { score: "0-100", qualified: "boolean", reasons: "string[]" },
    riskLevel: "low",
    sideEffectClass: "internal_write",
    minimumPermissionLevel: "assistant",
    idempotencyRequired: true,
  },
  {
    toolKey: "leadgen.update_crm",
    name: "Update CRM Classification",
    description: "Bounded non-sensitive lead update: soft status (contacted/engaged), qualification notes, next action. Qualification and disqualification have their own tools.",
    category: "data",
    inputSchema: { leadId: "uuid", expectedLeadRevision: "number", status: "contacted | engaged?", qualificationNotes: "string|null?", nextAction: "string|null?" },
    outputSchema: { leadId: "uuid", status: "string", revision: "number" },
    riskLevel: "low",
    sideEffectClass: "internal_write",
    minimumPermissionLevel: "assistant",
    idempotencyRequired: true,
  },
  {
    toolKey: "leadgen.mark_call_later",
    name: "Mark Call Later",
    description: "Records that a lead should be phoned rather than messaged (e.g. the number is not on WhatsApp), as a next action plus a CRM activity.",
    category: "data",
    inputSchema: { leadId: "uuid", expectedLeadRevision: "number", reason: "whatsapp_unavailable | no_answer | requested_callback | wrong_number", note: "string?" },
    outputSchema: { leadId: "uuid", nextAction: "string" },
    riskLevel: "low",
    sideEffectClass: "internal_write",
    minimumPermissionLevel: "assistant",
    idempotencyRequired: true,
  },
  {
    toolKey: "leadgen.mark_interested",
    name: "Mark Interested",
    description: "Qualifies a lead on recorded evidence and, when a pipeline and stage are supplied, converts it into a real opportunity.",
    category: "data",
    inputSchema: { leadId: "uuid", expectedLeadRevision: "number", evidence: "string", pipelineId: "uuid?", stageId: "uuid?" },
    outputSchema: { leadId: "uuid", status: "string", opportunityId: "uuid|null" },
    riskLevel: "medium",
    sideEffectClass: "internal_write",
    minimumPermissionLevel: "operator",
    idempotencyRequired: true,
  },
  {
    toolKey: "leadgen.mark_not_interested",
    name: "Mark Not Interested",
    description: "Disqualifies a lead with a recorded reason. Does NOT suppress the contact — consent withdrawal is a separate, explicit action.",
    category: "data",
    inputSchema: { leadId: "uuid", expectedLeadRevision: "number", reason: "string" },
    outputSchema: { leadId: "uuid", status: "string", suppressed: "false" },
    riskLevel: "medium",
    sideEffectClass: "internal_write",
    minimumPermissionLevel: "operator",
    idempotencyRequired: true,
  },
  {
    toolKey: "leadgen.generate_demo",
    name: "Generate Demo Content",
    description: "Stores business-specific demo copy in a fixed, validated shape. Refuses copy containing claims the business's own data does not support. Clears any prior review.",
    category: "data",
    inputSchema: { leadId: "uuid", expectedCompanyRevision: "number", styleKey: "demo style", eyebrow: "string", headline: "string", intro: "string", imageLine: "string", experienceLabel: "string", experienceTitle: "string", closing: "string", experiences: "3 x {title, description}" },
    outputSchema: { demoUrl: "string", styleKey: "string", reviewRequiredBeforeOutreach: "true" },
    riskLevel: "medium",
    sideEffectClass: "internal_write",
    minimumPermissionLevel: "assistant",
    idempotencyRequired: true,
  },
  {
    toolKey: "leadgen.review_demo",
    name: "Review Demo",
    description: "Scores the demo from the business's real data, records the render-check observations, and stores the verdict that gates outreach. The score is computed here, never supplied by the caller.",
    category: "data",
    inputSchema: { leadId: "uuid", expectedCompanyRevision: "number", renderChecks: "render observations|null", reviewerNote: "string|null" },
    outputSchema: { score: "0-100", passed: "boolean", eligibleForOutreach: "boolean", reason: "string" },
    riskLevel: "medium",
    sideEffectClass: "internal_write",
    minimumPermissionLevel: "assistant",
    idempotencyRequired: true,
  },
  {
    toolKey: "leadgen.regenerate_demo",
    name: "Regenerate Demo",
    description: "Clears generated copy and the review so the demo must be rebuilt and re-reviewed before any outreach.",
    category: "data",
    inputSchema: { leadId: "uuid", expectedCompanyRevision: "number", reason: "string" },
    outputSchema: { cleared: "true", eligibleForOutreach: "false" },
    riskLevel: "medium",
    sideEffectClass: "internal_write",
    minimumPermissionLevel: "assistant",
    idempotencyRequired: true,
  },
  {
    toolKey: "leadgen.draft_outreach",
    name: "Draft Outreach",
    description: "Composes the exact English outreach text, market price and WhatsApp template parameters for one lead. Writes nothing and sends nothing. Refuses when the demo has not passed review.",
    category: "communication",
    inputSchema: { leadId: "uuid" },
    outputSchema: { bodyText: "string", whatsappTemplateName: "string", templateParameters: "string[]", priceDisplay: "string" },
    riskLevel: "low",
    sideEffectClass: "read_only",
    minimumPermissionLevel: "assistant",
    idempotencyRequired: false,
  },
  {
    toolKey: "leadgen.create_outreach_batch",
    name: "Create Outreach Batch",
    description: "Builds an unapproved bulk batch for ONE market from leads that pass market, demo-review, suppression and consent checks, with per-recipient template values and sender frozen at snapshot time. Refuses a connection that is not a verified whatsapp_cloud_api sender. Reports every rejected lead and why.",
    category: "communication",
    inputSchema: { name: "string", market: "JO | CA", integrationConnectionId: "uuid (verified whatsapp_cloud_api sender for that market)", leadIds: "uuid[]", campaignId: "uuid|null", requireExplicitOptIn: "boolean" },
    outputSchema: { batchId: "uuid", market: "JO | CA", senderConnectionId: "uuid", recipientCount: "number", rejected: "reasons[]", approvalRequired: "true" },
    riskLevel: "medium",
    sideEffectClass: "internal_write",
    minimumPermissionLevel: "assistant",
    idempotencyRequired: true,
  },
  {
    toolKey: "leadgen.submit_batch_for_approval",
    name: "Submit Batch For Approval",
    description: "Submits a batch into the existing human approval workflow. The requesting agent can never approve its own batch.",
    category: "communication",
    inputSchema: { batchId: "uuid", summary: "string" },
    outputSchema: { batchId: "uuid", status: "pending_approval", approvalRequestId: "uuid" },
    riskLevel: "medium",
    sideEffectClass: "internal_write",
    minimumPermissionLevel: "assistant",
    idempotencyRequired: true,
  },
  {
    toolKey: "leadgen.send_approved_batch",
    name: "Send Approved Batch",
    description: "Queues an already-approved batch onto the Communications OS worker. Refuses any batch a human has not approved. Sends nothing itself and confirms no delivery.",
    category: "communication",
    inputSchema: { batchId: "uuid", requireExplicitOptIn: "boolean" },
    outputSchema: { queued: "number", skipped: "number", delivered: "0" },
    riskLevel: "high",
    sideEffectClass: "external_write",
    minimumPermissionLevel: "operator",
    // Approval is enforced at the Communications OS domain layer (the batch
    // must already be `approved`, by a human, through the one approval
    // system). A second Tool Runtime approval on the same action would mean
    // two approvals for one send — deliberately not enabled, exactly as
    // `communications.send` already reasons.
    approvalRequired: false,
    idempotencyRequired: true,
  },
  {
    toolKey: "leadgen.get_delivery_status",
    name: "Get Delivery Status",
    description: "Reads live message status for a batch or a set of messages, marking which were confirmed by a real provider message ID.",
    category: "communication",
    inputSchema: { batchId: "uuid?", messageIds: "uuid[]?" },
    outputSchema: { counts: "status counts", messages: "per-message status" },
    riskLevel: "low",
    sideEffectClass: "read_only",
    minimumPermissionLevel: "observer",
    idempotencyRequired: false,
  },
  {
    toolKey: "leadgen.mark_whatsapp_sent",
    name: "Log Manual WhatsApp Send",
    description: "Records that a human sent a WhatsApp message by hand outside LYNQ. Creates a CRM activity only; never a message row, never a 'sent' status, never counted as delivery.",
    category: "data",
    inputSchema: { leadId: "uuid", sentAt: "ISO datetime", note: "string?" },
    outputSchema: { activityId: "uuid", recordedAs: "manual_unverified", countedInDeliveryAnalytics: "false" },
    riskLevel: "low",
    sideEffectClass: "internal_write",
    minimumPermissionLevel: "assistant",
    idempotencyRequired: true,
  },
  {
    toolKey: "leadgen.suppress_contact",
    name: "Suppress Contact",
    description: "Adds an active suppression for an identity on a channel. Every send path re-checks suppressions immediately before dispatch.",
    category: "communication",
    inputSchema: { channel: "whatsapp | sms | email", identity: "string", reason: "suppression reason", source: "string?" },
    outputSchema: { suppressionId: "uuid", active: "true" },
    riskLevel: "medium",
    sideEffectClass: "internal_write",
    minimumPermissionLevel: "assistant",
    idempotencyRequired: true,
  },
  {
    toolKey: "leadgen.process_inbound_reply",
    name: "Process Inbound Reply",
    description: "Records a reply classification and its consequences. A literal STOP in the message overrides the supplied classification and suppresses the contact regardless.",
    category: "communication",
    inputSchema: { conversationId: "uuid", classification: "reply classification", confidence: "0-1", rationale: "string" },
    outputSchema: { classification: "string", suppressed: "boolean", overriddenByKeyword: "boolean" },
    riskLevel: "medium",
    sideEffectClass: "internal_write",
    minimumPermissionLevel: "assistant",
    idempotencyRequired: true,
  },
  {
    toolKey: "leadgen.draft_follow_up",
    name: "Draft Follow Up",
    description: "Creates a follow-up DRAFT on an existing conversation. Cannot approve, queue or send.",
    category: "communication",
    inputSchema: { conversationId: "uuid", bodyText: "string", idempotencyKey: "string", providerTemplate: "template directive|null" },
    outputSchema: { messageId: "uuid", status: "draft", requiresApproval: "true" },
    riskLevel: "low",
    sideEffectClass: "internal_write",
    minimumPermissionLevel: "assistant",
    idempotencyRequired: true,
  },
  {
    toolKey: "leadgen.get_campaign_analytics",
    name: "Get Campaign Analytics",
    description: "Demo, lead, batch and delivery counts. Reports provider-confirmed sends and development-provider simulations separately.",
    category: "data",
    inputSchema: { batchId: "uuid?", dateRangeStrategy: "analytics range", includeOrganizationMetrics: "boolean" },
    outputSchema: { demos: "counts", leads: "counts", batch: "batch funnel|null", organizationMetrics: "metric values|null" },
    riskLevel: "low",
    sideEffectClass: "read_only",
    minimumPermissionLevel: "observer",
    idempotencyRequired: false,
  },
];

export async function seedLeadGenTools(db: Db): Promise<{ registered: string[]; alreadyPresent: string[] }> {
  const registered: string[] = [];
  const alreadyPresent: string[] = [];

  for (const entry of SEED_ENTRIES) {
    if (await getCurrentToolVersion(db, entry.toolKey)) {
      alreadyPresent.push(entry.toolKey);
      continue;
    }
    await registerTool(db, { ...entry, requiredCapabilities: [] });
    registered.push(entry.toolKey);
  }

  return { registered, alreadyPresent };
}

export const LEAD_GEN_TOOL_SEED_ENTRIES = SEED_ENTRIES;
