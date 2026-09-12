import "server-only";

// Contact enquiries — read and status side, for the admin inbox.
//
// The table has existed since the contact form shipped, with a `status` column
// (new / read / resolved) clearly intended for an inbox. That inbox was never
// built, so the only way Rand could read a customer enquiry was to open the
// Supabase dashboard. The write path lives in src/app/contact/actions.ts.
//
// service_role only, like orders: public.contact_inquiries revokes every grant
// from anon and authenticated, so nothing but the server can read these.

import { createAdminClient } from "@/lib/supabase/admin";
import { logOrderError } from "@/lib/logger";

export const INQUIRY_STATUSES = ["new", "read", "resolved"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export interface Inquiry {
  id: string;
  name: string;
  email: string;
  topic: string;
  message: string;
  status: InquiryStatus;
  createdAt: string;
}

export async function listInquiries(limit = 200): Promise<Inquiry[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("contact_inquiries")
    .select("id, name, email, topic, message, status, created_at")
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 500)));

  if (error || !data) {
    if (error) logOrderError(error.message, { operation: "list_contact_inquiries" });
    return [];
  }

  return data.map((row) => {
    const r = row as Record<string, unknown>;
    const status = String(r.status ?? "new");
    return {
      id: String(r.id),
      name: String(r.name ?? ""),
      email: String(r.email ?? ""),
      topic: String(r.topic ?? ""),
      message: String(r.message ?? ""),
      status: (INQUIRY_STATUSES as readonly string[]).includes(status)
        ? (status as InquiryStatus)
        : "new",
      createdAt: String(r.created_at ?? ""),
    };
  });
}

/** Returns false when the id or status is not something we recognise. */
export async function updateInquiryStatus(id: string, status: string): Promise<boolean> {
  if (!id || !(INQUIRY_STATUSES as readonly string[]).includes(status)) return false;
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("contact_inquiries")
    .update({ status })
    .eq("id", id);
  if (error) {
    logOrderError(error.message, { operation: "update_contact_inquiry_status" });
    return false;
  }
  return true;
}

export async function countNewInquiries(): Promise<number> {
  const supabase = createAdminClient();
  const { count, error } = await supabase
    .from("contact_inquiries")
    .select("id", { count: "exact", head: true })
    .eq("status", "new");
  if (error) return 0;
  return count ?? 0;
}
