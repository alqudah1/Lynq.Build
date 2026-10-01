"use client";

import { useId, useState } from "react";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

interface Concept {
  headline: string;
  primaryText: string;
  cta: string;
  visualConcept: string;
}

const CONTROL = "lynq-transition min-h-11 w-full rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground placeholder:text-subtle hover:border-border-strong focus-visible:border-accent/60";
const LABEL = "text-xs uppercase tracking-[0.1em] text-subtle";

/**
 * Ad copy + visual concepts from the real creative-concepts API for the
 * selected brand. RECOMMENDATION ONLY: concepts are returned and shown —
 * never saved as ads, never sent to an ad platform.
 */
export function CreativeConceptsPanel({ organizationId, brandProfileId, platforms }: { organizationId: string; brandProfileId: string; platforms: { value: string; label: string }[] }) {
  const [objective, setObjective] = useState("");
  const [audience, setAudience] = useState("");
  const [platform, setPlatform] = useState(platforms[0]?.value ?? "facebook");
  const [concepts, setConcepts] = useState<Concept[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { objective: useId(), audience: useId(), platform: useId() };

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (!objective.trim()) {
      setError("Describe the objective first.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/organizations/${organizationId}/social/advertising/creative-concepts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brandProfileId, objective: objective.trim().slice(0, 500), audience: audience.trim().slice(0, 1000), platform, count: 4 }),
        cache: "no-store",
        credentials: "same-origin",
      });
      const body = (await response.json().catch(() => null)) as { data?: { concepts?: Concept[] }; error?: { message?: string } } | null;
      if (!response.ok) {
        setError(body?.error?.message ?? "Could not generate concepts. Please try again.");
        return;
      }
      setConcepts(body?.data?.concepts ?? []);
    } catch {
      setError("Network error — nothing was generated.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={(e) => void generate(e)} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.objective} className={LABEL}>Objective *</label>
          <input id={ids.objective} value={objective} onChange={(e) => setObjective(e.target.value)} maxLength={500} required placeholder="e.g. book discovery calls from local restaurant owners" className={CONTROL} />
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.audience} className={LABEL}>Audience</label>
            <input id={ids.audience} value={audience} onChange={(e) => setAudience(e.target.value)} maxLength={1000} placeholder="Who should see it" className={CONTROL} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.platform} className={LABEL}>Platform</label>
            <select id={ids.platform} value={platform} onChange={(e) => setPlatform(e.target.value)} className={CONTROL}>
              {platforms.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>
        <button type="submit" disabled={pending} className="lynq-glass lynq-transition inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-sm px-5 text-xs font-medium uppercase tracking-[0.08em] text-foreground hover:border-border-strong disabled:opacity-50 sm:w-auto sm:self-start">
          {pending ? (
            <>
              <span aria-hidden="true" className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
              Writing concepts…
            </>
          ) : concepts ? "Generate again" : "Generate concepts"}
        </button>
      </form>
      {error ? <StatusMessage tone="error" message={error} /> : null}
      <div aria-live="polite">
        {concepts && concepts.length === 0 ? <p className="text-sm text-subtle">No concepts came back. Try a more specific objective.</p> : null}
        {concepts && concepts.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {concepts.map((c, i) => (
              <li key={`${c.headline}-${i}`} className="flex flex-col gap-2 rounded-md border border-border bg-elevated p-4">
                <span className="text-[0.65rem] uppercase tracking-[0.12em] text-subtle">Concept {i + 1} · recommendation only</span>
                {c.headline ? <p className="text-sm font-medium text-foreground">{c.headline}</p> : null}
                {c.primaryText ? <p className="whitespace-pre-wrap text-sm text-muted">{c.primaryText}</p> : null}
                {c.cta ? <p className="text-xs text-foreground">Button: {c.cta}</p> : null}
                {c.visualConcept ? <p className="text-xs text-subtle">Visual: {c.visualConcept}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
