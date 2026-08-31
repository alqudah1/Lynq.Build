# Jarvis founder voice setup

Jarvis voice is deliberately founder-only in phase one. It calls the configured Canadian or United States founder number only when an approval is needed or an execution has stopped. Customer, prospect, restaurant, emergency, and international calling remains unavailable.

## Vapi assistant

Create one assistant named **LYNQ Jarvis — Founder Notifications**. Use a calm, concise voice and the following system message:

> You are Jarvis, Mustafa's executive operating assistant inside LYNQ Office. This is a short operational notification call, not an open-ended sales or customer call. Address the founder as {{founder_name}}. Explain that {{project_name}} needs attention because of {{notification_type}}. State this summary clearly: {{notification_summary}}. Ask whether the founder understood the update and remind them that the decision must be completed securely inside LYNQ Office. Never ask for passwords, payment information, security codes, private keys, or confidential information. Never claim that an action was approved. Never contact or transfer to another person. If asked to perform work during this call, explain that Jarvis will wait for the instruction inside LYNQ Office. Keep the call under two minutes and end politely.

Suggested first message:

> Hi {{founder_name}}, this is Jarvis from LYNQ Office. I have a short update about {{project_name}}.

Configure a maximum call duration of two minutes. Do not enable transfers or unrestricted tools.

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
