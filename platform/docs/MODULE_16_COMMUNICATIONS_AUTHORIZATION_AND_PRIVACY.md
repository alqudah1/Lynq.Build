# Module 16 — Communications Authorization & Privacy

Companion to `MODULE_16_COMMUNICATIONS_CORE.md`. Full detail on the permission model, its independence from CRM/Sales/Marketing/Brain, and the privacy rules governing message content, credentials, and rate-limit keys.

## The capability model

`src/lib/communications-os/authz.ts`. Four roles:

| Role | Capabilities |
|---|---|
| `communications_admin` | all eight |
| `communications_manager` | `communications_view`, `communications_draft`, `communications_send`, `communications_manage_templates`, `communications_manage_consent`, `communications_manage_bulk` |
| `communications_agent` | `communications_view`, `communications_draft`, `communications_send` |
| `viewer` | `communications_view` |

Capabilities are a closed eight-value set: `communications_view`, `communications_draft`, `communications_send`, `communications_manage_templates`, `communications_manage_connections`, `communications_manage_consent`, `communications_manage_bulk`, `communications_admin`. The role → capability mapping lives in exactly one place, `ROLE_CAPABILITIES` in `authz.ts`; every `requireCommunicationsXAuthority` function calls the shared `hasCommunicationCapability`/`requireCommunicationCapability` pair, never a raw `role === "..."` comparison elsewhere.

Storage: `communication_role_assignments` — one **active** role per user per organization, enforced by a partial unique index (`WHERE revoked_at IS NULL`). Revocation is soft, matching every other soft-revoke table in this codebase.

## Organization owner/admin bootstrap

`resolveCommunicationAuthContext` returns `{organizationId, actorUserId, orgRole, communicationRole}`. `hasCommunicationCapability` returns `true` unconditionally for `orgRole ∈ {owner, admin}` — an org admin can create the first connection and grant the first Communications role with zero setup, identical to every other module's bootstrap rule. Not a stored role — recomputed on every call.

## Independence from CRM/Sales/Marketing/Brain — "Sales or Marketing permissions never automatically grant sending ability"

This is the load-bearing rule the spec states explicitly, and it holds structurally, not by convention:

- **Sales OS**: `sales-integration.ts`'s `createSequenceCommunicationDraft` calls Communications OS's own `createDraftMessage`, which independently requires `communications_draft` capability for the acting user (the sequence's `systemActorUserId`). A Sales rep with full `sales_admin` capability but no Communications role cannot draft or send — verified directly.
- **Marketing OS**: `marketing-integration.ts`'s `createBulkBatchFromApprovedContent` calls Communications OS's own `createTemplate`/`createBulkBatch`, each independently requiring `communications_manage_templates`/`communications_manage_bulk`. A Marketing admin with full `marketing_admin` capability but no Communications role cannot create a template — verified directly.
- **CRM Core**: has no separate grantable role beyond the org owner/admin bootstrap every module shares — there is no "CRM permission" distinct from that bootstrap to test independence against beyond what the Sales/Marketing tests already establish.

No Communications OS function ever checks a Sales/Marketing/CRM role directly, and no Sales/Marketing/CRM function ever checks a Communications role. The two-gate composition (source-subsystem permission + Communications permission) is structural: `createSequenceCommunicationDraft`/`createBulkBatchFromApprovedContent` are the ONLY functions crossing the boundary, and each is a genuinely independent function call into Communications OS's own authorization-gated service, never a bypass.

## Agent-launched actions require no additional Communications OS bootstrap

A user's Communications role — even `communications_admin` — grants no special agent-launch authority beyond the ordinary Agent Runtime execution lifecycle checks every module already relies on. Launching a Communications Assistant task still goes through the real `createExecution`/`assignExecution`/`startExecution` lifecycle. An unseeded organization (the Communications Assistant never registered) rejects every draft-launch attempt regardless of the caller's Communications role — default deny, not "any Communications admin can invoke the agent."

## Approval decision authority — structural, not policy

`applyMessageApprovalDecision`/`applyBulkApprovalDecision` call the real Runtime `approveRequest`/`rejectRequest` — both REQUIRE a human `actorUserId`, enforced by Agent Runtime itself, not by anything in this module. An agent cannot decide its own (or any) approval; this is proven by construction, the same discipline every other module's approval integration relies on.

## Denial and audit

`requireCommunicationCapability`'s failure path (`denyAndAudit`) records a `communication_send_permission_denied` audit event before throwing the shared `InsufficientRoleError` — identical shape to every other module's own `*_permission_denied` event. Metadata carries only the capability name and a UUID-shaped target id.

## Reused error classes

`TenantResourceNotFoundError` and `InsufficientRoleError` (`src/lib/authz/errors.ts`) are reused directly. Communications-OS-specific business-rule errors (`StaleCommunicationUpdateError`, `InvalidMessageTransitionError`, `MessageNotApprovedError`, `AgentCannotApproveOwnMessageError`, `RecipientSuppressedError`, `ConsentRequiredError`, `ConnectionNotUsableError`, `DuplicateActiveBulkBatchError`, `CommunicationRateLimitedError`, etc.) live in `src/lib/communications-os/errors.ts`/`rate-limits.ts` as `DomainRuleViolationError` subclasses.

## Credential security

`secrets.ts`. AES-256-GCM with a 32-byte key from `INTEGRATION_CREDENTIAL_ENCRYPTION_KEY`. Unlike `agent_credentials`' one-way SHA-256 hash (sufficient there, since Runtime only ever needs to VERIFY a bearer token, never present it to a third party), a provider adapter must actually present the real secret to send — a hash is structurally insufficient, so this is genuinely encrypted, decrypted only at the moment of use (`resolveActiveCredentialSecret`, called exclusively from `processSendJob`/`verifyConnection`) and never logged, returned from an API, or placed in an audit event. With no encryption key configured, `storeConnectionCredential` fails closed (`IntegrationCredentialEncryptionUnavailableError`) — there is no plaintext-storage fallback path. Verified directly: a distinctive credential secret is stored, then asserted absent from every row of that organization's `audit_logs`.

## PII and privacy

Continues Module 12/13/15's privacy model, extended for high-value communications content:

- **Message bodies never appear in audit metadata** — verified directly with a distinctive body string.
- **Provider secrets never appear in audit metadata, API responses, or worker logs** — no code path in this module ever logs a decrypted credential.
- **Rate-limit keys never contain a raw recipient identity** — `rate-limits.ts` hashes every recipient (SHA-256, truncated) before it becomes part of a key.
- **Tool Runtime evidence is bounded** — `communications.list_conversation`'s tool output truncates each message body to 500 characters and caps the returned message count at 20; `communications.get_status` never returns a body at all.
- **Agent context is minimum-necessary** — `createDraftReplyTask`/`createDraftFollowUpTask` read at most 10 recent messages, and the Communications Assistant never reads CRM data directly (it operates entirely on Communications OS's own conversation/message rows).

## Retention

Message content (`bodyText`) and attachment metadata persist indefinitely in this module, matching every other module's own content-retention posture (no automatic deletion policy exists anywhere in this codebase yet). Provider events (`communication_provider_events`) deliberately never store the raw webhook payload — only the bounded, normalized fields the dedup/processing logic itself needs — so there is no raw-payload retention question to answer for this module's own tables. A future dedicated retention/archival module, if built, would apply uniformly across every module's content tables, not something this module should solve alone.
