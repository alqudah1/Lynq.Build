import "server-only";

// Service-role Supabase client — bypasses RLS entirely. This is the ONLY
// client allowed to write to orders/order_items or to catalog tables (e.g.
// seeding). The `server-only` import above makes it a build error if this
// file is ever imported into a Client Component bundle. SUPABASE_SERVICE_ROLE_KEY
// deliberately has no NEXT_PUBLIC_ prefix, so Next.js never inlines it into
// client JavaScript.
//
// Use this only from Server Actions / Route Handlers that themselves
// validate input server-side (see src/lib/orders.ts) — never expose this
// client's queries directly to arbitrary user input without validation.

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "createAdminClient: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
