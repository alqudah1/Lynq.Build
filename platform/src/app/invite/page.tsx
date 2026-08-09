import Link from "next/link";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getSessionCookie } from "@/lib/auth/cookies";
import { requireAuthenticatedUser } from "@/lib/authz/helpers";
import { getInvitationPreviewByHash, type InvitationPreview } from "@/lib/invitations/invitations";
import { readInvitationContinuationCookie, loadInvitationContinuationSecret } from "@/lib/invitations/continuation";
import { InvitationAcceptButton } from "@/components/invite/InvitationAcceptButton";

export const dynamic = "force-dynamic";

const OUTCOME_MESSAGE: Record<"accepted" | "failed", string> = {
  accepted: "Invitation accepted.",
  failed: "This invitation could not be completed.",
};

function formatExpiry(value: Date): string {
  return value.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">{children}</main>;
}

function UnavailableState() {
  return (
    <Shell>
      <p className="text-xs uppercase tracking-[0.3em] text-subtle">Invitation</p>
      <h1 className="font-serif text-3xl italic font-light text-foreground">Invitation is no longer available</h1>
      <p className="max-w-sm text-sm text-muted">
        This invitation link is invalid, expired, or has already been used. Ask whoever invited you to send a new one.
      </p>
    </Shell>
  );
}

function OutcomeState({ outcome, canRetry }: { outcome: "accepted" | "failed"; canRetry: boolean }) {
  return (
    <Shell>
      <p className="text-xs uppercase tracking-[0.3em] text-subtle">Invitation</p>
      <h1 className="font-serif text-3xl italic font-light text-foreground">{OUTCOME_MESSAGE[outcome]}</h1>
      {outcome === "accepted" ? (
        <Link
          href="/app"
          className="border border-border px-6 py-3 text-xs font-medium uppercase tracking-[0.08em] text-foreground transition-opacity hover:opacity-80"
        >
          Continue to LYNQ
        </Link>
      ) : canRetry ? (
        <>
          <p className="max-w-sm text-sm text-muted">You&rsquo;re signed in — you can try accepting it again.</p>
          <InvitationAcceptButton label="Try again" />
        </>
      ) : (
        <p className="max-w-sm text-sm text-muted">Ask whoever invited you to send a new invitation.</p>
      )}
    </Shell>
  );
}

/**
 * `redirectTo` is built as a computed value (matching `/sign-in-required`'s
 * own OAuth-link construction exactly), not a bare string literal — the
 * login-initiation route reads it from a real query string either way, but
 * this keeps both call sites consistent rather than one being a literal
 * and the other assembled.
 */
function SignInState({ preview }: { preview: InvitationPreview }) {
  const redirectParam = encodeURIComponent("/invite");
  return (
    <Shell>
      <p className="text-xs uppercase tracking-[0.3em] text-subtle">You&rsquo;re invited</p>
      <h1 className="font-serif text-3xl italic font-light text-foreground">Join {preview.organizationName}</h1>
      <p className="max-w-sm text-sm text-muted">
        Sign in with the email this invitation was sent to ({preview.email}) to accept it. This invitation expires on{" "}
        {formatExpiry(preview.expiresAt)}.
      </p>
      <div className="flex w-full max-w-xs flex-col gap-3">
        <a
          href={`/api/auth/google?redirectTo=${redirectParam}`}
          className="border border-border px-6 py-3 text-xs font-medium uppercase tracking-[0.08em] text-foreground transition-opacity hover:opacity-80"
        >
          Continue with Google
        </a>
        <a
          href={`/api/auth/microsoft?redirectTo=${redirectParam}`}
          className="border border-border px-6 py-3 text-xs font-medium uppercase tracking-[0.08em] text-foreground transition-opacity hover:opacity-80"
        >
          Continue with Microsoft
        </a>
      </div>
    </Shell>
  );
}

function ReadyToAcceptState({ preview }: { preview: InvitationPreview }) {
  return (
    <Shell>
      <p className="text-xs uppercase tracking-[0.3em] text-subtle">You&rsquo;re invited</p>
      <h1 className="font-serif text-3xl italic font-light text-foreground">Join {preview.organizationName}</h1>
      <p className="max-w-sm text-sm text-muted">
        You&rsquo;ve been invited as {preview.role}
        {preview.workspaceName ? ` and to the "${preview.workspaceName}" workspace as ${preview.workspaceRole}` : ""}. This invitation
        expires on {formatExpiry(preview.expiresAt)}.
      </p>
      <InvitationAcceptButton />
    </Shell>
  );
}

/**
 * The clean, token-free landing destination for invitation acceptance
 * (Step 5C, completing the deferred UI Step 4C.1's own exchange route
 * left as "out of scope for this pass"). Reads invitation state ONLY
 * through the signed continuation cookie and the safe `InvitationPreview`
 * shape (`organizationName`, `workspaceName`, `email`, `role`,
 * `workspaceRole`, `expiresAt`) — never a token, a hash, or any internal
 * ID, anywhere on this page. Five possible views, in priority order:
 *
 * 1. `?invitation=accepted|failed` — the OAuth callback just attempted
 *    acceptance; show that generic outcome. A "failed" outcome offers a
 *    retry ONLY if the continuation cookie is still present (a transient
 *    failure preserves it; a terminal one clears it) and only via the
 *    exact same generic accept action — never a different code path.
 * 2. `?status=unavailable` — the raw-token exchange itself rejected the
 *    token outright, before any cookie was ever set.
 * 3. No continuation cookie present (missing, tampered, or its own
 *    10-minute window expired) — nothing to show.
 * 4. A cookie IS present, but its invitation is dead
 *    (`InvitationNotAvailableError` — expired/revoked/already accepted).
 * 5. A cookie IS present and its invitation is genuinely live — show the
 *    safe preview, plus either a sign-in prompt (unauthenticated) or an
 *    Accept control (already authenticated), matching the two paths
 *    `POST /api/invitations/current/accept` itself already distinguishes.
 *
 * States 2–4 all render the IDENTICAL "no longer available" wording —
 * never distinguishing dead-token-at-exchange from dead-token-at-preview,
 * matching the same collapsed-response discipline the API layer already
 * applies to invitation lookups.
 */
export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; invitation?: string }>;
}) {
  const query = await searchParams;
  const env = loadEnv();
  const db = createDbClient(env);

  const outcome = query.invitation === "accepted" || query.invitation === "failed" ? query.invitation : null;
  const exchangeFailed = query.status === "unavailable";

  let secret: string;
  try {
    secret = loadInvitationContinuationSecret();
  } catch {
    return <UnavailableState />;
  }

  const continuation = await readInvitationContinuationCookie(secret);

  if (outcome) {
    return <OutcomeState outcome={outcome} canRetry={outcome === "failed" && continuation !== null} />;
  }

  if (exchangeFailed || !continuation) {
    return <UnavailableState />;
  }

  let preview: InvitationPreview;
  try {
    preview = await getInvitationPreviewByHash(db, continuation.invitationTokenHash);
  } catch {
    return <UnavailableState />;
  }

  const sessionToken = await getSessionCookie();
  let authenticated = false;
  if (sessionToken) {
    try {
      await requireAuthenticatedUser(db, sessionToken);
      authenticated = true;
    } catch {
      authenticated = false;
    }
  }

  return authenticated ? <ReadyToAcceptState preview={preview} /> : <SignInState preview={preview} />;
}
