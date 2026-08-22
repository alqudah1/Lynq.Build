import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { neon } from "@neondatabase/serverless";
import { createDbClient } from "@/db/client";
import { authenticateAgentFromHeader } from "@/lib/agents/authentication";
import { UnauthenticatedError } from "@/lib/authz/errors";
import { invokeTool } from "@/lib/tools/invocation";
import { listTools } from "@/lib/tools/definitions";
import { LEAD_GEN_TOOL_IMPLEMENTATIONS } from "@/lib/lead-gen/tools";
import { resolveOrOpenToolSession } from "@/lib/lead-gen/agent";

export const dynamic = "force-dynamic";

/**
 * ============================================================================
 * LYNQ MCP server — a transport, never a second backend
 * ============================================================================
 * A bounded Model Context Protocol endpoint over HTTP JSON-RPC that exposes
 * the registered lead-gen tools to an MCP client (Claude Code, the Agent
 * SDK, anything else that speaks MCP).
 *
 * The important property is what this file does NOT contain: no SQL, no
 * authority check of its own, no approval logic, no consent logic. Every
 * call is handed to `invokeTool`, which is the same single entry point
 * LYNQ's own agents go through, so an MCP caller gets exactly the
 * organization scoping, permission floor, live agent eligibility check,
 * input validation, rate limit, approval gate, idempotency guard and audit
 * record that an in-platform call gets. There is no privileged MCP path.
 *
 * Identity comes from an agent credential (`Authorization: Bearer …`), and
 * the organization comes from that credential — never from the request
 * body. A caller cannot name an organization, a user, or a permission
 * level; those are resolved, never asserted.
 */

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "lynq-lead-gen", version: "1.0.0" } as const;

/** JSON-RPC 2.0 error codes, plus the MCP-conventional application range. */
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string().min(1),
  params: z.unknown().optional(),
});

type JsonRpcId = string | number | null;

function rpcResult(id: JsonRpcId, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function rpcError(id: JsonRpcId, code: number, message: string, httpStatus = 200): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status: httpStatus });
}

const IMPLEMENTATION_BY_KEY = new Map(LEAD_GEN_TOOL_IMPLEMENTATIONS.map((tool) => [tool.toolKey, tool]));

/**
 * MCP tool names may not contain a dot in some clients, and `leadgen.` is
 * noise for a server that only serves lead-gen tools. The mapping is
 * total and reversible in both directions, and no name outside the
 * registered set is ever accepted.
 */
function toMcpName(toolKey: string): string {
  return toolKey.replace(/^leadgen\./, "").replace(/\./g, "_");
}

function fromMcpName(name: string): string | null {
  for (const key of IMPLEMENTATION_BY_KEY.keys()) {
    if (toMcpName(key) === name) return key;
  }
  return null;
}

export async function POST(request: Request) {
  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return rpcError(null, PARSE_ERROR, "Request body is not valid JSON");
  }

  const parsed = jsonRpcRequestSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return rpcError(null, INVALID_REQUEST, "Not a valid JSON-RPC 2.0 request");
  }
  const { id = null, method, params } = parsed.data;

  // A notification (no id) expects no response body at all.
  const isNotification = parsed.data.id === undefined;

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions:
        "LYNQ lead-gen tools. Every call runs inside a real LYNQ agent execution under the accountable human's own authority. You may research, enrich, score, generate and review demos, draft outreach, assemble batches, classify replies and draft follow-ups without asking. You may NOT send: outbound batches require a human approval decision recorded in LYNQ, and send_approved_batch refuses anything that has not been approved. Never describe a message as sent unless get_delivery_status reports a provider message ID.",
    });
  }

  if (method === "notifications/initialized") {
    return new Response(null, { status: 202 });
  }

  if (method === "ping") {
    return isNotification ? new Response(null, { status: 202 }) : rpcResult(id, {});
  }

  const env = loadEnv();
  const db = createDbClient(env);

  // Identity first, for every method that touches data. Organization scope
  // comes from the credential and from nowhere else.
  let principal;
  try {
    principal = await authenticateAgentFromHeader(db, request);
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return rpcError(id, INVALID_REQUEST, "Unauthenticated: provide a LYNQ agent credential as `Authorization: Bearer <secret>`", 401);
    }
    throw err;
  }

  if (method === "tools/list") {
    const definitions = await listTools(db, { onlyEnabled: true });
    const enabledByKey = new Map(definitions.map((definition) => [definition.toolKey, definition]));

    const tools = LEAD_GEN_TOOL_IMPLEMENTATIONS.filter((tool) => enabledByKey.has(tool.toolKey)).map((tool) => {
      const definition = enabledByKey.get(tool.toolKey)!;
      return {
        name: toMcpName(tool.toolKey),
        title: definition.name,
        description: definition.description,
        inputSchema: z.toJSONSchema(tool.inputSchema as z.ZodType, { io: "input" }),
        annotations: {
          readOnlyHint: definition.sideEffectClass === "read_only",
          // Nothing in this set deletes anything; the destructive-looking
          // operations clear a generated draft or a review, both re-creatable.
          destructiveHint: false,
          idempotentHint: definition.idempotencyRequired,
          openWorldHint: definition.sideEffectClass === "external_write",
        },
      };
    });

    return rpcResult(id, { tools });
  }

  if (method === "tools/call") {
    const callParams = z
      .object({
        name: z.string().min(1),
        arguments: z.record(z.string(), z.unknown()).default({}),
        /**
         * Optional caller-supplied idempotency key. Two calls with the same
         * key resolve to one invocation, which is what makes a retried MCP
         * request safe. Omitted, a fresh key is generated, so an accidental
         * retry WITHOUT a key is treated as a new call — the caller decides.
         */
        _meta: z.object({ idempotencyKey: z.string().trim().min(1).max(200).optional() }).optional(),
      })
      .safeParse(params);

    if (!callParams.success) return rpcError(id, INVALID_PARAMS, "tools/call requires { name, arguments }");

    const toolKey = fromMcpName(callParams.data.name);
    if (!toolKey) return rpcError(id, METHOD_NOT_FOUND, `Unknown tool "${callParams.data.name}"`);

    try {
      const rawSql = neon(env.DATABASE_URL);
      const execution = await resolveOrOpenToolSession(db, { organizationId: principal.organizationId, agentId: principal.agentId });

      const result = await invokeTool(db, rawSql, {
        organizationId: principal.organizationId,
        executionId: execution.id,
        agentId: principal.agentId,
        toolKey,
        idempotencyKey: callParams.data._meta?.idempotencyKey ?? `mcp:${crypto.randomUUID()}`,
        toolInput: callParams.data.arguments,
      });

      return rpcResult(id, {
        content: [{ type: "text", text: JSON.stringify(result.output, null, 2) }],
        structuredContent: result.output,
        isError: false,
      });
    } catch (err) {
      // A tool-level failure is reported as a RESULT with `isError`, per MCP:
      // the model needs to read what went wrong and adapt, not receive a
      // transport error it cannot see. The message is the domain error's own
      // text, which by construction never contains a credential.
      const message = err instanceof Error ? err.message : "Tool invocation failed";
      return rpcResult(id, { content: [{ type: "text", text: message }], isError: true });
    }
  }

  return rpcError(id, METHOD_NOT_FOUND, `Unknown method "${method}"`);
}

/** MCP clients probe for capability; a bare GET is not a stream this server supports. */
export async function GET() {
  return Response.json(
    { error: { code: INTERNAL_ERROR, message: "This MCP endpoint speaks JSON-RPC over POST only." } },
    { status: 405, headers: { allow: "POST" } }
  );
}
