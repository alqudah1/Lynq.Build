"use client";

import { useState } from "react";

/** Shows a newly-issued invitation link only to the administrator who created it. */
export function InvitationLink({ invitationPath }: { invitationPath: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? invitationPath : `${window.location.origin}${invitationPath}`;

  async function copyLink() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
  }

  return (
    <div className="mt-3 rounded-sm border border-success/30 bg-success-wash p-3">
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-success">Secure invitation link ready</p>
      <p className="mt-1 text-xs text-muted">Send this only to the invited employee. It expires with the invitation and stops working after acceptance.</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input aria-label="Secure invitation link" readOnly value={url} className="min-h-10 flex-1 rounded-sm border border-border bg-elevated px-3 text-xs text-foreground" />
        <button type="button" onClick={copyLink} className="lynq-transition min-h-10 rounded-sm border border-border px-4 text-xs font-medium uppercase tracking-[0.08em] text-foreground hover:border-border-strong">
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </div>
  );
}
