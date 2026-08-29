# Module 19 — WhatsApp Cloud API provider + lead-gen tool surface

## What this module is

Two things that only make sense together:

1. **A real Meta WhatsApp Cloud API provider** for Communications OS, replacing the
   `whatsapp_cloud_api` enum value that resolved to `undefined`.
2. **A bounded lead-gen tool surface** (21 tools) that Claude reaches over MCP, so
   discovery → demo → review → outreach → approval → send → reply runs inside LYNQ
   rather than beside it.

Nothing here is a second outreach product. Every write goes through CRM Core,
Communications OS and the Agent Runtime's existing service functions, and therefore
through their existing authority checks, revision guards, approval system and audit
events.

## The honesty rules this module is built around

- A WhatsApp message is **sent** only when Meta returned a real `wamid.…`. Anything
  else is `rejected` (nothing was created) or `uncertain` (genuinely unknown).
- The development provider (`dev_whatsapp`) is never presented as delivery. Its ids
  are prefixed `dev-whatsapp-`, `isRealDeliveryProvider("dev_whatsapp")` is false, and
  campaign analytics report its messages as `simulatedByDevelopmentProvider`, separate
  from `sentConfirmedByProvider`.
- `leadgen.mark_whatsapp_sent` records a human's manual send as a **CRM activity only**.
  It creates no message row, sets no `sent` status, and is excluded from delivery
  analytics — LYNQ has no provider message id for it and cannot confirm anything.
- An **uncertain** outcome is never retried automatically. A **rejected-because-rate-limited**
  outcome is, because the provider positively created nothing.

## Credential shape

A Cloud API connection needs more than one secret, so the whole set is stored as a
single JSON document inside the existing AES-256-GCM `integration_credentials`
ciphertext. Nothing is added in plaintext, and `parseWhatsAppCredential` is the only
reader.

```json
{
  "accessToken": "...",
  "phoneNumberId": "1234567890",
  "wabaId": "0987654321",
  "appSecret": "...",
  "webhookVerifyToken": "...",
  "graphApiVersion": "v23.0",
  "senderPhoneE164": "+962796940024"
}
```

`accessToken` is a system-user token carrying `whatsapp_business_messaging`.
`phoneNumberId` is the Cloud API Phone Number ID, not the phone number itself.
`appSecret` verifies `X-Hub-Signature-256` on webhooks; `webhookVerifyToken` is echoed
during Meta's GET handshake.

`verifyConnection` reads the phone number AND the WABA. A token that can see the
number but not its business account cannot manage or send templates, and finding that
out at the first campaign is far too late.

## Webhooks

One URL per connection: `POST|GET /api/integrations/whatsapp_cloud_api/{connectionId}/webhook`

- `GET` answers Meta's subscription handshake, constant-time comparing
  `hub.verify_token` against the connection's own stored token.
- `POST` verifies `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the app
  secret) and **fails closed** if the connection has no `appSecret`.
- Meta batches many facts into one POST. The route splits the payload into one
  envelope per message/status before the existing event pipeline sees it, each with a
  stable dedup key (`msg:<wamid>`, `status:<wamid>:<state>`). Processing only the first
  would silently drop every reply but one.
- A valid signature always gets a 200. Meta retries non-2xx for days and disables the
  subscription on sustained failure; an unmappable payload is ours to reconcile.

**STOP is honoured inside the webhook**, synchronously, by a deterministic keyword
check — before any model, queue or human is involved. The suppression insert runs with
a null actor and no authority check, because an opt-out must take effect even if
everything else fails.

## Market configuration

`lib/lead-gen/markets.ts` is the single source of truth.

| Market | Price | Sender | Language |
| --- | --- | --- | --- |
| `JO` | 25 JOD / month | +962 79 694 0024 | English |
| `CA` | 100 CAD / month | +1 647-892-7346 | English |

An unresolvable market returns `null`, never a default. The previous CRM code fell
through to the Canadian branch on an unknown country, quoting 100 CAD to leads whose
market simply was not known.

## Outreach copy

Defined once, as positional-parameter template bodies in the exact form Meta's editor
accepts (`OUTREACH_TEMPLATE_BODIES`). The CRM preview, the deep links and the real
Cloud API send all render the same string, and a test asserts that equality.

Two variants, because a WhatsApp template is fixed text with a fixed parameter count:

- `lynq_demo_direction_reviews_en` — for businesses with genuinely strong review data.
- `lynq_demo_direction_en` — same offer, no claim about reviews.

Parameters: `{{1}}` business name, `{{2}}` demo URL, `{{3}}` price display.

## Demo quality gate

Outreach is blocked unless the **stored review verdict** says otherwise. Two
independent things must hold:

- **Content** — computed from the business's real data, never asserted by a caller.
  Blocking checks: a real name, a known category, a reachable contact route.
- **Render** — an automated check must have actually observed the page: 200, no
  horizontal overflow, no broken images, no console errors, at a phone width and a
  desktop width. **"Not yet checked" is never treated as "fine."**

Minimum score 70. Enriching or regenerating clears the review, because a verdict
recorded against older facts no longer describes what a prospect would see.

RTL follows the **content**, not the country: a Jordanian business with an English
listing gets an English left-to-right page.

Generated demo copy passes `assertNoFabricatedClaims`, which refuses awards, founding
dates, ownership claims, superlative rankings, certifications, size claims, prices and
any reference to the page being a demo — unless the business's own published
description already says it.

## Model routing

`lib/lead-gen/models.ts`, same role-per-env-var shape as the Office:

| Role | Env var | Default |
| --- | --- | --- |
| research | `LEADGEN_RESEARCH_MODEL` | `anthropic/claude-sonnet-5` |
| content | `LEADGEN_CONTENT_MODEL` | `anthropic/claude-sonnet-5` |
| review | `LEADGEN_REVIEW_MODEL` | `anthropic/claude-opus-5` |
| classification | `LEADGEN_CLASSIFICATION_MODEL` | `anthropic/claude-haiku-4.5` |

Gateway `provider/model` strings. No credential in code, nothing reachable from the
browser.

## MCP

`POST /api/mcp` — JSON-RPC 2.0, `initialize` / `tools/list` / `tools/call` / `ping`.

Authentication is a LYNQ **agent credential** (`Authorization: Bearer …`), and the
organization comes from that credential — never from the request body. A caller cannot
name an organization, a user or a permission level.

Every call is handed to `invokeTool`, the same single entry point LYNQ's own agents use.
The route contains no SQL, no authority check of its own, no approval logic. There is
no privileged MCP path.

Each call runs inside a real agent execution owned by the agent's accountable human, so
every tool acts under **that person's** CRM and Communications authority. Revoking their
access immediately revokes the agent's reach.

## The approval boundary

Claude may, unattended: research, enrich, score, generate demo content, review demos,
draft outreach, assemble batches, classify replies, draft follow-ups, and update
non-sensitive CRM classifications.

Claude may not send. `leadgen.send_approved_batch` refuses any batch that is not already
`approved`, and approval decisions are human-only, enforced inside the Agent Runtime.
Once approved, the worker sends every recipient without a second per-recipient approval —
each having passed market, demo-quality, consent and suppression checks at snapshot time
and again live at send time.

## Setup

```
POST /api/organizations/{organizationId}/lead-gen/seed
```

Registers the Lead Generation Assistant, the 21 tool policies and the two Communications
OS outreach templates. Idempotent.

## Manual steps that no code here can do

1. Create the Meta app + WhatsApp Business Account; add both phone numbers.
2. Submit both template bodies verbatim in WhatsApp Manager (category MARKETING,
   English) and wait for approval. LYNQ publishing its own copy of the template does
   **not** approve anything at Meta.
3. Complete Meta Business verification and display-name approval for the sender numbers.
4. Point the webhook at the per-connection URL and subscribe to the `messages` field.
5. Store the credential document on the connection and run verify.

Until all five are done, `whatsapp_cloud_api` connections will not verify and no real
message can be sent.
