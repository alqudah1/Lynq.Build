"use client";

import { useState } from "react";
import Link from "next/link";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

/**
 * The one interactive control on the clean `/invite` landing (Step 5C) —
 * everything else on that page is server-rendered. Posts to the existing
 * `POST /api/invitations/current/accept` (Step 4C.1: reads the invitation
 * only from the signed continuation cookie, never a token this component
 * holds or could tamper with) and renders one of exactly three states:
 * idle/pending, a generic failure message, or a generic success message
 * with a link into the dashboard — never the response's specific error
 * code or any internal reason (expired/revoked/email_mismatch/
 * already_used all read identically here, matching the public wording
 * requirement).
 */
export function InvitationAcceptButton({ label = "Accept invitation" }: { label?: string }) {
  const [state, setState] = useState<"idle" | "pending" | "error" | "accepted">("idle");

  async function handleAccept() {
    setState("pending");
    try {
      const response = await fetch("/api/invitations/current/accept", { method: "POST" });
      if (!response.ok) {
        setState("error");
        return;
      }
      const body = await response.json();
      if (body?.data?.status === "oauth_required") {
        setState("error");
        return;
      }
      setState("accepted");
    } catch {
      setState("error");
    }
  }

  if (state === "accepted") {
    return (
      <div className="flex flex-col items-center gap-4">
        <p role="status" className="text-sm text-foreground">
          Invitation accepted.
        </p>
        <Link
          href="/app"
          className="border border-border px-6 py-3 text-xs font-medium uppercase tracking-[0.08em] text-foreground transition-opacity hover:opacity-80"
        >
          Continue to LYNQ
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={handleAccept}
        disabled={state === "pending"}
        className="min-h-11 border border-border px-6 py-3 text-xs font-medium uppercase tracking-[0.08em] text-foreground transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        {state === "pending" ? "Accepting…" : label}
      </button>
      {state === "error" ? <StatusMessage tone="error" message="This invitation could not be completed." /> : null}
    </div>
  );
}
