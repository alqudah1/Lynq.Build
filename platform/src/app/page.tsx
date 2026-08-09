import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--lynq-fg-subtle)]">
        LYNQ Core Platform
      </p>
      <h1 className="font-serif text-3xl italic font-light text-[color:var(--lynq-fg)]">
        LYNQ Platform
      </h1>
      <p className="max-w-md text-sm text-[color:var(--lynq-fg-muted)]">
        Sign in to open your workspace, or check{" "}
        <a href="/health" className="underline underline-offset-4">
          /health
        </a>{" "}
        for system status.
      </p>
      <Link
        href="/app"
        className="mt-2 rounded-sm border border-[color:var(--lynq-fg-muted)] px-5 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--lynq-fg)] underline-offset-4 hover:underline"
      >
        Go to app
      </Link>
    </main>
  );
}
