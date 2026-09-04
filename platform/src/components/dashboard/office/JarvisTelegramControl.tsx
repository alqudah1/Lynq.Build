"use client";

import { useCallback, useEffect, useState } from "react";

type TelegramLink = { id: string; username: string | null; linkedAt: string; lastSeenAt: string | null };

type PairingState = {
  available: boolean;
  reason: string | null;
  code: string | null;
  expiresInMs: number | null;
  links: TelegramLink[];
};

type PairingResponse = { data?: PairingState; error?: { message?: string } };

/**
 * Linking Telegram, from the one place that can prove who you are.
 *
 * The code shown here is the second factor for the whole Telegram lane: a
 * chat becomes trusted by presenting it, which means whoever links a chat
 * had a live authenticated session at that moment. So the panel is
 * deliberately plain about two things — that the code expires, and that
 * revoking is one button away.
 */
export function JarvisTelegramControl({ organizationId }: { organizationId: string }) {
  const [state, setState] = useState<PairingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/organizations/${organizationId}/jarvis/telegram`, { cache: "no-store", signal });
      const payload = (await response.json()) as PairingResponse;
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "Telegram pairing is unavailable.");
      setState(payload.data);
      setError(null);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "Telegram pairing is unavailable.");
    }
  }, [organizationId]);

  useEffect(() => {
    const controller = new AbortController();
    // Deferred out of the effect body for the same reason the directive
    // view defers its first load: a synchronous setState here cascades.
    const first = window.setTimeout(() => void load(controller.signal), 0);
    // The code rotates, so the panel re-reads it rather than showing a
    // stale one that would fail and burn an attempt.
    const timer = window.setInterval(() => void load(controller.signal), 60_000);
    return () => {
      controller.abort();
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load, refreshKey]);

  const revoke = useCallback(async () => {
    setBusy(true);
    try {
      await fetch(`/api/organizations/${organizationId}/jarvis/telegram`, { method: "DELETE", cache: "no-store" });
      setRefreshKey((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }, [organizationId]);

  return (
    <section aria-labelledby="jarvis-telegram-heading" className="office-panel grid gap-4">
      <div className="grid gap-1">
        <p className="text-[0.62rem] uppercase tracking-[0.18em] text-subtle">Reach Jarvis anywhere</p>
        <h2 id="jarvis-telegram-heading" className="font-serif text-2xl font-light text-foreground">Telegram</h2>
      </div>

      {error ? <p role="status" className="text-sm text-amber-100">{error}</p> : null}

      {state && !state.available ? <p className="text-sm leading-6 text-muted">{state.reason}</p> : null}

      {state?.available ? (
        <>
          <p className="text-sm leading-6 text-muted">
            Message your Jarvis bot on Telegram and send <code className="text-foreground">/start {state.code}</code> to link this chat. Then just type
            what you want done — Jarvis opens the project and comes back to you here when it needs a decision.
          </p>
          <p className="text-2xl font-medium tracking-[0.24em] text-foreground" aria-label="Pairing code">{state.code}</p>
          <p className="text-xs text-subtle">
            {state.expiresInMs !== null ? `Expires in about ${Math.max(1, Math.round(state.expiresInMs / 1000))} seconds. A new one appears automatically.` : null}
          </p>

          <div className="grid gap-2 border-t border-border pt-4">
            <p className="text-xs uppercase tracking-[0.14em] text-subtle">Linked chats</p>
            {state.links.length === 0 ? (
              <p className="text-sm text-muted">No chat is linked yet.</p>
            ) : (
              <ul className="grid gap-1 text-sm text-muted">
                {state.links.map((link) => (
                  <li key={link.id}>
                    {link.username ? `@${link.username}` : "A Telegram chat"} · linked {new Date(link.linkedAt).toLocaleDateString()}
                  </li>
                ))}
              </ul>
            )}
            {state.links.length > 0 ? (
              <button type="button" onClick={() => void revoke()} disabled={busy} className="justify-self-start text-xs text-amber-100 underline disabled:opacity-60">
                {busy ? "Unlinking…" : "Unlink every chat"}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
