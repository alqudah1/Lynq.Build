// Browser Supabase client — safe to import from Client Components. Uses the
// publishable (formerly "anon") key only, which is meant to be public and is
// subject to RLS on every table (see supabase/migrations). Never put the
// service_role key here.

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}
