"use server";

// Contact form persistence, then notification.
//
// WHERE A MESSAGE GOES: every valid submission is written to
// public.contact_inquiries, which is the source of record, and Rand reads it
// at /admin/inquiries. The table has NO anon or authenticated grant — this
// validated server action is the only write path, so the form cannot be used
// to insert arbitrary rows.
//
// An email notification is then ATTEMPTED. It is strictly best-effort: the row
// is already committed by that point, so a provider outage or missing
// credential can never turn a saved enquiry into an error for the customer.
// See src/lib/notify.ts for which environment variables switch it on — until
// they exist it reports `unconfigured` and sends nothing, rather than guessing
// an address to send customer messages to.

import { createAdminClient } from "@/lib/supabase/admin";
import { logOrderError } from "@/lib/logger";
import { notifyInquiry } from "@/lib/notify";

const TOPICS = ["Custom order", "Colours & yarns", "Shipping", "Ready for Delivery", "An existing order"];

export type ContactResult = { ok: true } | { ok: false; errors: string[] };

export async function submitInquiry(input: {
  name: string;
  email: string;
  topic: string;
  message: string;
  /** Honeypot: real users never fill this. Cheap, no third-party captcha. */
  website?: string;
}): Promise<ContactResult> {
  const name = (input.name ?? "").trim();
  const email = (input.email ?? "").trim();
  const topic = (input.topic ?? "").trim();
  const message = (input.message ?? "").trim();

  // Silently accept and drop obvious bots — telling them why helps them.
  if ((input.website ?? "").trim().length > 0) return { ok: true };

  const errors: string[] = [];
  if (!name) errors.push("Please enter your name.");
  else if (name.length > 120) errors.push("That name is too long.");
  if (!email) errors.push("Please enter an email address so we can reply.");
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("That email address doesn't look right.");
  if (!message) errors.push("Please write a message.");
  else if (message.length > 4000) errors.push("That message is too long. Please shorten it.");
  if (!TOPICS.includes(topic)) errors.push("Please choose a topic.");
  if (errors.length) return { ok: false, errors };

  const admin = createAdminClient();
  const { error } = await admin.from("contact_inquiries").insert({ name, email, topic, message });
  if (error) {
    // Persistence is the only thing that can fail the submission, because it
    // is the only thing that loses the message.
    logOrderError(error.message, { operation: "insert_contact_inquiry" });
    return { ok: false, errors: ["We couldn't send that just now. Please try again, or reach us on Instagram."] };
  }

  // Saved. Everything past this point is a convenience and is not allowed to
  // change what the customer is told.
  const outcome = await notifyInquiry({ name, email, topic, message });
  if (outcome === "failed") {
    logOrderError("enquiry saved but notification failed", {
      operation: "notify_contact_inquiry",
    });
  }

  return { ok: true };
}
