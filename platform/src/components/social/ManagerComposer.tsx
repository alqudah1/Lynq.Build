"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

/**
 * The AI Social Manager composer. Posts one turn to the real manager API
 * (same-origin, no cache), then refreshes the server-rendered transcript —
 * the transcript itself is never kept in client state, so what you see is
 * exactly what was stored. A turn can take a while (bounded tool loop), so
 * the pending state is explicit and the input stays disabled until it ends.
 */
export function ManagerComposer({ organizationId, threadId, initialPrompt, suggestions }: { organizationId: string; threadId: string; initialPrompt?: string; suggestions: string[] }) {
  const router = useRouter();
  const [value, setValue] = useState(initialPrompt ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
  const busy = sending;

  async function send(content: string) {
    const trimmed = content.trim();
    if (!trimmed || busy) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/organizations/${organizationId}/social/manager/threads/${threadId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? "The manager could not answer. Please try again.");
        return;
      }
      setValue("");
      startTransition(() => router.refresh());
    } catch {
      setError("Network error — your message was not sent.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {suggestions.length ? (
        <ul aria-label="Suggested prompts" className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setValue(s);
                  textareaRef.current?.focus();
                }}
                className="lynq-transition min-h-11 rounded-sm border border-border px-3 text-left text-xs text-muted hover:border-border-strong hover:text-foreground disabled:opacity-50"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(value);
        }}
        className="flex flex-col gap-2"
      >
        <label htmlFor={inputId} className="sr-only">
          Message the AI Social Manager
        </label>
        <textarea
          id={inputId}
          ref={textareaRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void send(value);
            }
          }}
          disabled={busy}
          rows={3}
          maxLength={8000}
          placeholder="Ask for a plan, drafts, or what needs attention…"
          className="lynq-transition min-h-24 w-full rounded-sm border border-border bg-elevated px-3 py-3 text-sm text-foreground placeholder:text-subtle hover:border-border-strong focus-visible:border-accent/60 disabled:opacity-60"
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-subtle">The manager drafts and proposes. It never approves, publishes, replies or touches ads.</p>
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="lynq-transition inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-sm bg-foreground px-5 text-xs font-medium uppercase tracking-[0.08em] text-background hover:opacity-90 disabled:pointer-events-none disabled:opacity-50 sm:w-auto"
          >
            {busy ? (
              <>
                <span aria-hidden="true" className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
                Working…
              </>
            ) : (
              "Send"
            )}
          </button>
        </div>
        <div aria-live="polite" className="sr-only">{busy ? "The manager is working on your request." : ""}</div>
        {error ? <StatusMessage tone="error" message={error} /> : null}
      </form>
    </div>
  );
}
