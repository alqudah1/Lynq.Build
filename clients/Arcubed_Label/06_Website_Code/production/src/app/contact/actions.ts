"use server";

// Contact form persistence.
//
// No email provider is configured and none is invented, so messages are stored
// in public.contact_inquiries and surfaced to Rand in the admin. The table has
// NO anon or authenticated grant — this validated server action is the only
// write path, so the form cannot be used to insert arbitrary rows.

import { createAdminClient } from "@/lib/supabase/admin";
import { logOrderError } from "@/lib/logger";

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
  else if (message.length > 4000) errors.push("That message is too long — please shorten it.");
  if (!TOPICS.includes(topic)) errors.push("Please choose a topic.");
  if (errors.length) return { ok: false, errors };

  const admin = createAdminClient();
  const { error } = await admin.from("contact_inquiries").insert({ name, email, topic, message });
  if (error) {
    logOrderError(error.message, { operation: "insert_contact_inquiry" });
    return { ok: false, errors: ["We couldn't send that just now. Please try again, or reach us on Instagram."] };
  }
  return { ok: true };
}
