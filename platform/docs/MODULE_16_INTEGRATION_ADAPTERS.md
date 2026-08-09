# Module 16 — Integration Adapters & Agent-Assisted Communication

Companion to `MODULE_16_COMMUNICATIONS_CORE.md`. Full detail on the provider adapter contract, each implemented provider, the Communications Assistant agent, and Tool Runtime integration.

## The provider adapter contract — why it's safe

`src/lib/communications-os/providers/types.ts`. Every provider — real or development — implements the identical `ProviderAdapter` interface:

```ts
export interface ProviderAdapter {
  provider: IntegrationProvider;
  channel: CommunicationChannel;
  capabilities: ProviderCapabilities;
  verifyConnection(credential: ProviderCredential): Promise<VerifyConnectionResult>;
  sendMessage(credential: ProviderCredential, input: SendMessageInput): Promise<SendMessageResult>;
  fetchStatus?(credential: ProviderCredential, providerMessageId: string): Promise<FetchStatusResult>;
  normalizeInboundEvent(rawPayload: unknown): NormalizedInboundEvent | null;
  normalizeDeliveryEvent(rawPayload: unknown): NormalizedDeliveryEvent | null;
  validateRecipient(recipient: string): RecipientValidationResult;
  mapProviderError(err: unknown): { failureClass: CommunicationFailureClass; failureCode: string };
}
```

Every method returns one of a small number of closed, bounded shapes (`SendMessageResult`, `NormalizedInboundEvent`, `NormalizedDeliveryEvent`, etc.) — no arbitrary provider SDK response object, webhook payload, or error object ever crosses into domain logic (`messages.ts`, `webhooks.ts`) unnormalized. `providers/registry.ts` is an in-code, typed map (`Record<IntegrationProvider, ProviderAdapter>`) — the same "no dynamic require/import, no data-driven dispatch" discipline Module 14's task handler registry and Marketing OS's audience filter registry already established. Resolving an unimplemented provider (`twilio`, `whatsapp_cloud_api`) throws a clear `ProviderNotImplementedError` — never a silent fallback to a differently-named provider.

## `SendMessageResult.outcome` — the three-way contract that makes uncertainty explicit

Every adapter's `sendMessage` returns one of exactly three outcomes:

- `"accepted"` — the provider genuinely took the message; `providerMessageId` is set.
- `"rejected"` — the provider genuinely refused it (invalid recipient, permanent error); safe to mark the message `"failed"` immediately.
- `"uncertain"` — a network error, timeout, or ambiguous response; the provider's own outcome for THIS specific send attempt is unknown. `messages.ts`'s `processSendJob` never treats `"uncertain"` as success or failure — it leaves the message at `"sending"` for reconciliation to resolve (see `MODULE_16_COMMUNICATIONS_DELIVERY_AND_RECOVERY.md`), never blindly retrying under the same idempotency key.

## Resend (email) — the one real provider path

`providers/resend.ts`. `sendMessage` makes a real `POST https://api.resend.com/emails` call with an `Idempotency-Key` header (Resend's own idempotency support, reused rather than reimplemented) and maps the response: `200`/`201` with a real `id` → `"accepted"`; `429`/`5xx` → `"uncertain"` (provider_timeout); any other non-2xx → `"rejected"` (provider_rejected). `verifyConnection` calls Resend's own `GET /api-keys` as a real, bounded liveness check.

`verifyResendWebhookSignature` implements Resend's Svix-format webhook signing: `v1,<base64 HMAC-SHA256>` computed over `${svixId}.${svixTimestamp}.${rawBody}`, using the webhook secret's payload after its `whsec_` prefix, base64-decoded as the HMAC key — verified with a constant-time comparison (`timingSafeEqualStrings`), never a plain `===` on attacker-supplied bytes.

**This environment has no `RESEND_API_KEY` or `RESEND_WEBHOOK_SECRET` configured.** The adapter is fully implemented and typechecked but genuinely never exercised against a live Resend account by any test, the concurrency suite, or the manual E2E run — every one of those uses `dev_email` instead. This is a deliberate, disclosed limitation, not a hidden gap: see "Real-provider result" in the final report.

## Development providers — truthful, not fake

`providers/dev-email.ts`, `dev-sms.ts`, `dev-whatsapp.ts`. Each `verifyConnection` always succeeds (there is no real account to fail against). Each `sendMessage` logs the send to the server console with a distinctive `[communications-os][dev-*]` prefix and returns a synthetic `providerMessageId` — `outcome: "accepted"`, truthfully representing "this stand-in accepted it," never "a real email/SMS/WhatsApp message was delivered." `capabilities.supportsDeliveryEvents: false` on all three is the load-bearing detail: a message sent through a development provider can reach `"sent"` and stops there — no code path in `webhooks.ts` or `messages.ts` can ever move it to `"delivered"` without a real delivery event, and none of these providers' `normalizeDeliveryEvent` ever returns non-null. `dev_email`'s `normalizeInboundEvent` additionally accepts a fixed, dev-only synthetic payload shape (`{externalEventId, senderReference, recipientReference, bodyText, subject?, externalThreadId?}`) — clearly documented as a dev-only test payload shape, purely so the inbound pipeline is exercisable end-to-end without a real vendor account.

## The Communications Assistant agent

`agents.ts`. One agent, registered through the real Agent Registry lifecycle exactly like every other module's agents (Module 8/13/15's forward-only stage sequence, permission raised to `assistant`), driving synchronously through the real Agent Runtime execution lifecycle (`driveThroughToExecuting`, in one call rather than through the Runtime job queue — mirroring Sales/Marketing OS's own agents, since these tasks are bounded, single-shot reads with no external tool latency to hide behind the job queue).

**`communications_draft_reply`** (`createDraftReplyTask`):
- Reads up to 10 of the conversation's own most recent messages, via the launching human's own Communications view authority (`getConversationForUser`) — never a separate agent-specific grant.
- Recipient is always the conversation's own last INBOUND message's sender — a reply always addresses whoever last wrote in. If there is no inbound message, the task reports missing information rather than guessing a recipient.
- Produces a `draft_text` artifact (a structural, deterministic reply skeleton — never fabricated "creative" prose) plus one new `communication_messages` row in `draft` status, `createdByAgentId` set.

**`communications_draft_follow_up`** (`createDraftFollowUpTask`):
- Same bounded shape, given a `reason` string. Recipient is the counterpart of the most recent message in either direction (whoever the org has actually been corresponding with).

**Neither task type may**: send directly (the created message is always `status: "draft"`), override suppression, approve its own output (`approveDraftDirectly` structurally rejects an agent-authored draft — `AgentCannotApproveOwnMessageError`; the formal Runtime approval path additionally requires a human `actorUserId`, enforced by `approveRequest` itself), change CRM ownership/stage, or invent a recipient.

## Why `draft_text`, not `report` — a deliberate divergence from the shared evidence helper

Module 14's shared `resolveReportArtifactTaskState` helper only ever looks for an artifact with `artifactType === "report"`. Both Communications OS task types produce `draft_text` artifacts (a message draft is not a "report" — the same judgment Marketing OS's own Content Draft Assistant already made). Rather than mislabel the artifact type just to fit the shared helper (which Marketing OS's `marketing_content_draft` handler does, a latent inconsistency that has no functional consequence there since the content item's own state doesn't depend on it), this module's `resolveDraftArtifactTaskState` is a small, local counterpart that filters for `draft_text` instead — otherwise identical: a live check of the linked execution, never a cached status.

## Tool Runtime — reusing the exact Module 8 mechanism

`tools-seed.ts` registers four tools via the same `registerTool`/`tool_definitions` mechanism Module 8 built — the `"communication"` tool category already existed in the schema's `tool_category` enum, unused until now:

| Tool | Side effect class | Approval required | What it does |
|---|---|---|---|
| `communications.create_draft` | `internal_write` | no | Creates a canonical draft only |
| `communications.send` | `external_write` | **no** (domain-gated instead) | Enqueues an ALREADY-approved message |
| `communications.get_status` | `read_only` | no | Live status read |
| `communications.list_conversation` | `read_only` | no | Bounded, truncated conversation preview |

`communications.send`'s `approvalRequired: false` is deliberate, not an oversight: the underlying `queueMessageForSend` service function already refuses an unapproved message (`MessageNotApprovedError`) — enabling Tool Runtime's OWN approval gate on top would create a second, redundant approval system for the exact same action. Every tool implementation resolves the calling execution's `ownerUserId` (`resolveExecutionById`) and uses it as the human authority for the underlying Communications OS call — the identical "agent acts through the launching human's own authority" pattern Sales/Marketing OS's own tool-adjacent code already establishes, not a new agent-specific bypass.

A workflow reaches these tools through the Workflow Engine's already-generic `tool_invocation` node (`{agentId, toolKey}` configuration) — no engine change was needed, proving the node type genuinely supports an arbitrary new tool category, not just the three Module 8 shipped with.
