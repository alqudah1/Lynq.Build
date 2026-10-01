"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

interface Idea {
  title: string;
  kind: string;
  objective: string;
  platforms: string[];
  hook: string;
  angle: string;
  whyNow: string;
}

const PLATFORM_LABEL: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", tiktok: "TikTok", youtube: "YouTube", x: "X" };

/**
 * "Get ideas" — calls the real studio ideas API for the selected brand and
 * renders what the model returned. Ideas are not saved; "Use this idea"
 * only prefills the create form through the URL.
 */
export function IdeasPanel({ organizationId, brandProfileId, createPath }: { organizationId: string; brandProfileId: string; createPath: string }) {
  const [theme, setTheme] = useState("");
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const themeId = useId();

  async function load() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/organizations/${organizationId}/social/studio/ideas`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brandProfileId, count: 5, ...(theme.trim() ? { theme: theme.trim().slice(0, 500) } : {}) }),
        cache: "no-store",
        credentials: "same-origin",
      });
      const body = (await response.json().catch(() => null)) as { data?: { ideas?: Idea[] }; error?: { message?: string } } | null;
      if (!response.ok) {
        setError(body?.error?.message ?? "Could not get ideas. Please try again.");
        return;
      }
      setIdeas(body?.data?.ideas ?? []);
    } catch {
      setError("Network error — no ideas were generated.");
    } finally {
      setPending(false);
    }
  }

  function ideaHref(idea: Idea): string {
    const qs = new URLSearchParams({ brand: brandProfileId, title: idea.title, kind: idea.kind, objective: idea.objective, topic: idea.angle || idea.title, hook: idea.hook, platforms: idea.platforms.join(",") });
    return `${createPath}?${qs.toString()}`;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={themeId} className="text-xs uppercase tracking-[0.1em] text-subtle">Theme (optional)</label>
        <input id={themeId} value={theme} onChange={(e) => setTheme(e.target.value)} maxLength={500} placeholder="e.g. back to school, a new service" className="lynq-transition min-h-11 rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground placeholder:text-subtle hover:border-border-strong focus-visible:border-accent/60" />
      </div>
      <button type="button" onClick={() => void load()} disabled={pending} className="lynq-glass lynq-transition inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-sm px-5 text-xs font-medium uppercase tracking-[0.08em] text-foreground hover:border-border-strong disabled:opacity-50">
        {pending ? (
          <>
            <span aria-hidden="true" className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
            Thinking…
          </>
        ) : ideas ? "Get more ideas" : "Get ideas"}
      </button>
      {error ? <StatusMessage tone="error" message={error} /> : null}
      <div aria-live="polite">
        {ideas && ideas.length === 0 ? <p className="text-sm text-subtle">No ideas came back. Try a theme.</p> : null}
        {ideas && ideas.length ? (
          <ul className="flex flex-col gap-2">
            {ideas.map((idea, index) => (
              <li key={`${idea.title}-${index}`} className="flex flex-col gap-2 rounded-md border border-border bg-elevated p-3">
                <p className="text-sm font-medium text-foreground">{idea.title}</p>
                {idea.hook ? <p className="text-sm text-muted">“{idea.hook}”</p> : null}
                {idea.angle ? <p className="text-xs text-subtle">{idea.angle}</p> : null}
                {idea.whyNow ? <p className="text-xs text-subtle">Why now: {idea.whyNow}</p> : null}
                <p className="text-xs text-subtle">{idea.platforms.map((p) => PLATFORM_LABEL[p] ?? p).join(" · ")}</p>
                <Link href={ideaHref(idea)} className="lynq-transition inline-flex min-h-11 items-center justify-center rounded-sm border border-border px-4 text-xs font-medium uppercase tracking-[0.08em] text-foreground hover:border-border-strong">Use this idea</Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
