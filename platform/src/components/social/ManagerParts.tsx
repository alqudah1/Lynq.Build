import Link from "next/link";
import type { SocialManagerThread } from "@/lib/social-os/manager";
import type { AiProviderAvailability } from "@/lib/social-os/providers/ai/types";
import { createManagerThreadAction } from "@/lib/dashboard/actions/social";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatDateTime, socialHref } from "./format";

export function managerSuggestions(brandName: string | null): string[] {
  return [
    `Plan next week's content for ${brandName ?? "my brand"}`,
    "Create three posts for parents",
    "Show me what needs attention today",
    "Analyze last month's posts",
  ];
}

/** Honest "no text model" state — names the exact env keys the server is missing; never a fake chat. */
export function AiSetupCard({ providers }: { providers: AiProviderAvailability[] }) {
  const text = providers.filter((p) => p.kind === "text");
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-medium text-foreground">Connect an AI text provider to use the manager</h2>
        <Badge tone="warning">Setup needed</Badge>
      </div>
      <p className="text-sm text-muted">The AI Social Manager needs one configured text model on this server. Nothing is simulated while it is missing — the rest of Social keeps working.</p>
      <ul className="flex flex-col gap-2">
        {text.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-foreground">{p.label}</span>
            {p.configured ? <Badge tone="success">Configured</Badge> : <span className="text-subtle">missing {p.missing.join(", ")}</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ManagerThreadList({ organizationSlug, threads, activeThreadId, brandParam, timeZone }: { organizationSlug: string; threads: SocialManagerThread[]; activeThreadId?: string; brandParam?: string; timeZone: string }) {
  if (!threads.length) return <p className="text-sm text-subtle">No conversations yet.</p>;
  return (
    <ul className="flex flex-col gap-1">
      {threads.map((t) => {
        const active = t.id === activeThreadId;
        return (
          <li key={t.id}>
            <Link
              href={socialHref(organizationSlug, `/social/manager/${t.id}`, { brand: brandParam })}
              aria-current={active ? "page" : undefined}
              className={`lynq-transition flex min-h-11 flex-col justify-center rounded-sm border px-3 py-2 ${active ? "border-border-strong bg-glass-strong" : "border-transparent hover:border-border"}`}
            >
              <span className="truncate text-sm text-foreground">{t.title}</span>
              <span className="text-xs text-subtle">{formatDateTime(t.lastMessageAt, timeZone)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function NewThreadForm({ organizationSlug, brandProfileId }: { organizationSlug: string; brandProfileId?: string }) {
  return (
    <ActionForm action={createManagerThreadAction.bind(null, organizationSlug)} hiddenFields={brandProfileId ? { brandProfileId } : undefined} className="flex flex-col gap-2 [&_button]:w-full">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-[0.1em] text-subtle">New conversation</span>
        <input name="title" maxLength={200} placeholder="Optional title" className="lynq-transition min-h-11 rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground placeholder:text-subtle hover:border-border-strong focus-visible:border-accent/60" />
      </label>
      <SubmitButton variant="glass" pendingLabel="Starting…">Start conversation</SubmitButton>
    </ActionForm>
  );
}
