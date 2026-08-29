import { describe, it, expect } from "vitest";
import { LEAD_GEN_TOOL_IMPLEMENTATIONS, LEAD_GEN_TOOL_KEYS } from "./index";
import { LEAD_GEN_TOOL_SEED_ENTRIES } from "./seed";

/**
 * These assert the POLICY of the tool surface, which is where a mistake is
 * both easy to make and expensive: a send tool registered one permission
 * level too low, or a write tool registered read-only, would quietly widen
 * what an agent can do without any test failing anywhere else.
 */

const seedByKey = new Map(LEAD_GEN_TOOL_SEED_ENTRIES.map((entry) => [entry.toolKey, entry]));

/** The 20 tool names the lead-gen surface is specified to expose. */
const REQUIRED_TOOLS = [
  "find_qualified_leads",
  "get_lead",
  "enrich_lead",
  "score_lead",
  "generate_demo",
  "review_demo",
  "regenerate_demo",
  "draft_outreach",
  "create_outreach_batch",
  "submit_batch_for_approval",
  "send_approved_batch",
  "get_delivery_status",
  "process_inbound_reply",
  "draft_follow_up",
  "mark_whatsapp_sent",
  "mark_call_later",
  "mark_interested",
  "mark_not_interested",
  "suppress_contact",
  "update_crm",
  "get_campaign_analytics",
];

describe("lead-gen tool surface", () => {
  it("exposes every specified tool", () => {
    for (const name of REQUIRED_TOOLS) {
      expect(LEAD_GEN_TOOL_KEYS).toContain(`leadgen.${name}`);
    }
  });

  it("has an implementation and a registered policy for every tool, with no orphans either way", () => {
    const implementationKeys = [...LEAD_GEN_TOOL_KEYS].sort();
    const seedKeys = LEAD_GEN_TOOL_SEED_ENTRIES.map((entry) => entry.toolKey).sort();
    expect(implementationKeys).toEqual(seedKeys);
  });

  it("registers each tool exactly once", () => {
    expect(new Set(LEAD_GEN_TOOL_KEYS).size).toBe(LEAD_GEN_TOOL_KEYS.length);
  });

  it("namespaces every tool under leadgen. and validates its input with a schema", () => {
    for (const tool of LEAD_GEN_TOOL_IMPLEMENTATIONS) {
      expect(tool.toolKey.startsWith("leadgen.")).toBe(true);
      expect(tool.inputSchema).toBeDefined();
      expect(tool.version).toBe(1);
    }
  });
});

describe("permission and side-effect policy", () => {
  it("puts the only outbound-reaching tool at operator level and marks it an external write", () => {
    const send = seedByKey.get("leadgen.send_approved_batch")!;
    expect(send.minimumPermissionLevel).toBe("operator");
    expect(send.sideEffectClass).toBe("external_write");
    expect(send.riskLevel).toBe("high");
  });

  it("is the ONLY external write in the whole set", () => {
    const externalWrites = LEAD_GEN_TOOL_SEED_ENTRIES.filter((entry) => entry.sideEffectClass === "external_write").map((entry) => entry.toolKey);
    expect(externalWrites).toEqual(["leadgen.send_approved_batch"]);
  });

  it("requires operator level for the two tools that change a lead's commercial meaning", () => {
    expect(seedByKey.get("leadgen.mark_interested")!.minimumPermissionLevel).toBe("operator");
    expect(seedByKey.get("leadgen.mark_not_interested")!.minimumPermissionLevel).toBe("operator");
  });

  it("leaves everything Claude may do unattended at assistant level or below", () => {
    const unattended = [
      "leadgen.find_qualified_leads",
      "leadgen.get_lead",
      "leadgen.enrich_lead",
      "leadgen.score_lead",
      "leadgen.generate_demo",
      "leadgen.review_demo",
      "leadgen.regenerate_demo",
      "leadgen.draft_outreach",
      "leadgen.create_outreach_batch",
      "leadgen.submit_batch_for_approval",
      "leadgen.process_inbound_reply",
      "leadgen.draft_follow_up",
      "leadgen.update_crm",
      "leadgen.mark_call_later",
      "leadgen.get_campaign_analytics",
    ];
    for (const key of unattended) {
      expect(["observer", "assistant"]).toContain(seedByKey.get(key)!.minimumPermissionLevel);
    }
  });

  it("never registers a destructive, financial or permission-changing tool", () => {
    for (const entry of LEAD_GEN_TOOL_SEED_ENTRIES) {
      expect(["read_only", "internal_write", "external_write"]).toContain(entry.sideEffectClass);
    }
  });

  it("requires an idempotency key for every tool that writes", () => {
    for (const entry of LEAD_GEN_TOOL_SEED_ENTRIES) {
      if (entry.sideEffectClass === "read_only") continue;
      expect(entry.idempotencyRequired).toBe(true);
    }
  });

  it("keeps the read-only tools genuinely read-only", () => {
    for (const key of ["leadgen.find_qualified_leads", "leadgen.get_lead", "leadgen.draft_outreach", "leadgen.get_delivery_status", "leadgen.get_campaign_analytics"]) {
      expect(seedByKey.get(key)!.sideEffectClass).toBe("read_only");
    }
  });

  it("describes the manual-send log as never counting as delivery", () => {
    const entry = seedByKey.get("leadgen.mark_whatsapp_sent")!;
    expect(entry.sideEffectClass).toBe("internal_write");
    expect(entry.description).toMatch(/never a 'sent' status/);
    expect(entry.description).toMatch(/never counted as delivery/);
  });

  it("states in the send tool's own description that it refuses unapproved batches", () => {
    expect(seedByKey.get("leadgen.send_approved_batch")!.description).toMatch(/refuses any batch a human has not approved/i);
  });
});
