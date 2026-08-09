"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Calls the existing `POST /api/auth/logout` route (Step 3) — never
 * reimplements session revocation client-side. That route revokes the
 * database session row immediately and clears the cookie; this component's
 * only job afterward is to navigate the browser away from the now-stale
 * dashboard view.
 */
export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/sign-in-required");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={pending}
      className="lynq-transition min-h-11 w-full rounded-sm border border-border px-3 text-left text-sm text-foreground hover:border-border-strong hover:bg-white/[0.03] disabled:opacity-50"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
