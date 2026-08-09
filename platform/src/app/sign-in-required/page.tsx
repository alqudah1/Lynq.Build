import { resolveSafeRedirectTarget } from "@/lib/auth/redirects";

export const dynamic = "force-dynamic";

/**
 * The "simple sign-in-required state" the dashboard guard redirects to
 * (Step 5A). Deliberately outside the `/app` route tree so the guard can
 * never redirect into itself. `returnTo` is re-validated here too (never
 * trusted from the query string alone) even though `requireDashboardUser`
 * already validated it once when constructing this URL — a user can visit
 * this page directly with an arbitrary query string, so the same
 * internal-relative-only check must run again at the point it's actually
 * used.
 */
export default async function SignInRequiredPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;
  const safeReturnTo = resolveSafeRedirectTarget(returnTo, "/app");
  const redirectParam = encodeURIComponent(safeReturnTo);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="text-xs uppercase tracking-[0.3em] text-subtle">Sign in required</p>
      <h1 className="font-serif text-3xl italic font-light text-foreground">Continue to LYNQ</h1>
      <p className="max-w-sm text-sm text-muted">
        Your session has ended, or you&rsquo;re not signed in yet. Sign in to continue.
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
    </main>
  );
}
