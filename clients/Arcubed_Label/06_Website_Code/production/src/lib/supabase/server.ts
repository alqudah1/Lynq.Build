import "server-only";

// Server Supabase client for use in Server Components/Route Handlers — reads
// the request's cookies so it runs as the visiting browser would (still just
// the publishable key + RLS, no elevated privileges). This is NOT the
// service-role client — see ./admin.ts for the server-only privileged client
// used by order creation.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./types";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component that can't set cookies (no
            // active session refresh happening here anyway — no auth yet).
          }
        },
      },
    }
  );
}
