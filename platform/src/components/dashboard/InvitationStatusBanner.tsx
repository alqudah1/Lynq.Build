"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const SAFE_MESSAGES: Record<string, string> = {
  accepted: "Invitation accepted.",
  failed: "This invitation could not be completed.",
};

/**
 * Renders only the two generic, public-safe invitation outcomes the OAuth
 * callback ever puts on the URL (`?invitation=accepted|failed` — Step
 * 4C.1) — never the specific internal reason (expired/revoked/
 * email_mismatch/already_used/tenant_mismatch), which never leaves the
 * server in the first place; this component only ever sees the two
 * word values above, nothing else. Any other/unrecognized value is
 * ignored rather than displayed verbatim, so this can never become a
 * channel for showing arbitrary query-string content.
 *
 * Strips the `invitation` query parameter from the URL immediately after
 * the first render (a safe, client-side `router.replace`, never a full
 * reload) so refreshing the page doesn't keep re-showing it — the visible
 * banner itself persists until the user explicitly dismisses it, per Step
 * 5A's "dismiss after display OR remove from the URL" requirement (this
 * does both).
 */
export function InvitationStatusBanner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // Computed once, during the initial render (a lazy `useState` initializer,
  // not a side effect) — reads the URL exactly once, per the requirement.
  const [status] = useState<string | null>(() => {
    const raw = searchParams.get("invitation");
    return raw === "accepted" || raw === "failed" ? raw : null;
  });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!status) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("invitation");
    const queryString = nextParams.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    // Intentionally run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!status || dismissed) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-4 border border-border bg-elevated px-4 py-3 text-sm text-foreground"
    >
      <p>{SAFE_MESSAGES[status]}</p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="flex min-h-11 min-w-11 items-center justify-center text-subtle transition-opacity hover:opacity-80"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
