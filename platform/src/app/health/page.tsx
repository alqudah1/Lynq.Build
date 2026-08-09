import { checkHealth } from "@/lib/health-check";

// Same reasoning as the API route: force dynamic rendering so this page
// performs a real database check on every request rather than serving a
// prerendered/cached result.
export const dynamic = "force-dynamic";

export default async function HealthPage() {
  const result = await checkHealth();
  const isOk = result.status === "ok";

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--lynq-fg-subtle)]">
        System Status
      </p>
      <p
        className="font-serif text-2xl italic font-light"
        style={{
          color: isOk ? "var(--lynq-fg)" : "var(--lynq-accent-foreground)",
        }}
      >
        {isOk ? "All systems operational" : "Degraded"}
      </p>
      <dl className="grid grid-cols-[auto_auto] gap-x-8 gap-y-2 text-sm text-[color:var(--lynq-fg-muted)]">
        <dt className="text-left">Application</dt>
        <dd className="text-left">ok</dd>
        <dt className="text-left">Database</dt>
        <dd className="text-left">{result.database}</dd>
      </dl>
    </main>
  );
}
