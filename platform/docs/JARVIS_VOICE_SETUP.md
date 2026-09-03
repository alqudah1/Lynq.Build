# Jarvis founder voice setup

Jarvis voice is deliberately founder-only in phase one. It calls the configured Canadian or United States founder number only when an approval is needed or an execution has stopped. Customer, prospect, restaurant, emergency, and international calling remains unavailable.

## Vapi assistant

Create one assistant named **LYNQ Jarvis — Founder Notifications**. The production assistant currently uses Claude Sonnet 4.6 with temperature `0.2`, a calm concise voice, and the following system message:

> You are Jarvis, Mustafa's executive operating assistant inside LYNQ Office. This is a two-way operational call, and your highest priority is listening.
>
> Conversation rules:
> 1. Greet {{founder_name}} and ask whether now is a good time. Do not deliver the update until the founder answers.
> 2. When the founder starts speaking, stop speaking immediately. Never talk over or compete with the founder.
> 3. Wait for the founder to finish their full thought. Treat short pauses as thinking time, not the end of their turn.
> 4. Acknowledge what the founder said in one short sentence before answering.
> 5. Give the update from {{notification_summary}} in no more than two short sentences. Translate technical language into plain business language. Never invent missing facts.
> 6. Ask only one question at a time. For an approval_needed update, ask the founder to review and decide securely inside LYNQ Office. For an execution_stopped update, ask whether they want a short explanation of what stopped.
> 7. Answer follow-up questions using only the project context provided in this call. If the answer is not available, say so clearly and offer to show it in LYNQ Office.
> 8. Do not repeat the entire update unless asked. Keep every response concise and conversational.
> 9. If the founder says stop, not now, later, goodbye, or anything equivalent, acknowledge once and end the call politely.
>
> Safety and authority:
> - Speech during this call never counts as approval and must never trigger external work.
> - Never claim an action was approved, completed, or sent unless the supplied context explicitly says so.
> - Never ask for passwords, payment information, security codes, private keys, or confidential information.
> - Never contact or transfer to another person.
> - If asked to perform work during the call, explain that Jarvis will wait for the instruction inside LYNQ Office.
> - Keep the call under two minutes.

Suggested first message:

> Hi {{founder_name}}, it’s Jarvis. I have a brief update about {{project_name}}. Is now a good time?

Configure a maximum call duration of two minutes. Use LiveKit smart endpointing with a `0.7` second wait, and configure interruption after one word with `0.15` voice seconds and a `2` second backoff. Do not enable transfers or unrestricted tools.

## Import the funded Twilio number

In the Vapi dashboard:

1. Open **Phone Numbers** and choose **Create Phone Number**.
2. Choose **Import Twilio**.
3. Enter the funded Twilio number, Account SID, and Auth Token directly in Vapi. Never paste them into source code, GitHub, or an agent chat.
4. Leave SMS disabled for this phase unless it is being configured separately.
5. Copy the resulting Vapi phone-number ID for secure environment setup.

## Call activity connection

Create a Vapi Bearer Token custom credential. Use a new random secret and enable the `Bearer` prefix. Configure the assistant server URL as:

`https://app.lynq.build/api/integrations/vapi/webhook`

Subscribe only to `status-update`, `end-of-call-report`, and `hang` events for phase one. Store the matching bearer token in the production `VAPI_WEBHOOK_SECRET` environment variable.

## Production environment variables

- `JARVIS_VOICE_NOTIFICATIONS_ENABLED=true`
- `VAPI_API_KEY`
- `VAPI_ASSISTANT_ID`
- `VAPI_PHONE_NUMBER_ID`
- `JARVIS_FOUNDER_PHONE_E164`
- `VAPI_WEBHOOK_SECRET`

All values are server-only Vercel Sensitive Environment Variables. After saving them, create a new deployment before attempting the founder test call.

## First test

Use an approval-required test project owned by Mustafa. Confirm:

1. The Office creates the approval and stops safely.
2. Email notification is sent or honestly reports not configured.
3. Jarvis calls only the configured founder number.
4. The call names the correct project and explains the approval.
5. The call never treats speech as approval; the decision remains inside **My Work**.
6. Vapi status events appear in protected server logs without credentials or full phone numbers.

---

## Inbound phone control (separate lane)

Everything above describes phase-one **outbound** founder notification calls,
which are unchanged.

Secure **two-way** phone control — where Mustafa calls Jarvis, describes work,
and the confirmed instruction returns to LYNQ Office — is a separate lane,
disabled by default behind `JARVIS_PHONE_COMMANDS_ENABLED`. It requires
additional Vapi dashboard changes (a server URL for inbound, three extra
server-message subscriptions, and a longer maximum duration on the inbound
assistant only).

See `platform/docs/JARVIS_PHONE_CONTROL.md` for the full design, the
verification model, the approval boundary, and the exact dashboard steps.
