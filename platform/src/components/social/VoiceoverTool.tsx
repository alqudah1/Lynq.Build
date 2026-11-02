"use client";

import { useId, useState } from "react";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

type Clip = { n: number; text: string; url?: string; error?: string; seconds?: number };

const STYLES = [
  { value: "ar-levant", label: "Arabic, Levantine (Amman)" },
  { value: "ar-msa", label: "Arabic, Modern Standard" },
  { value: "en", label: "English" },
];
const VOICES = ["onyx", "ash", "echo", "verse", "nova", "coral", "sage", "shimmer", "alloy", "ballad", "fable"];

const field = "lynq-transition min-h-11 rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground placeholder:text-subtle hover:border-border-strong focus-visible:border-accent/60";
const button = "lynq-glass lynq-transition inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-5 text-xs font-medium uppercase tracking-[0.08em] text-foreground hover:border-border-strong disabled:opacity-50";

/**
 * Voiceover: one MP3 per script line, so each line can be placed on its own beat in a reel.
 * Clips are made on demand and never stored; download them and drop them into the edit.
 */
export function VoiceoverTool({ organizationId }: { organizationId: string }) {
  const [script, setScript] = useState("");
  const [style, setStyle] = useState("ar-levant");
  const [voice, setVoice] = useState("onyx");
  const [prefix, setPrefix] = useState("voice");
  const [clips, setClips] = useState<Clip[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { script: useId(), style: useId(), voice: useId(), prefix: useId() };

  const name = (n: number) => `${prefix.trim().replace(/[^\w-]+/g, "-") || "voice"}-${String(n).padStart(2, "0")}.mp3`;

  async function generate() {
    const lines = script.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 40);
    if (!lines.length) return setError("Add at least one line.");
    clips.forEach((c) => c.url && URL.revokeObjectURL(c.url));
    setPending(true);
    setError(null);
    const out: Clip[] = lines.map((text, i) => ({ n: i + 1, text }));
    setClips([...out]);
    for (const clip of out) {
      try {
        const res = await fetch(`/api/organizations/${organizationId}/social/voiceover`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: clip.text.slice(0, 600), style, voice }), cache: "no-store", credentials: "same-origin" });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          clip.error = body?.error?.message ?? "Could not make this clip.";
        } else {
          clip.url = URL.createObjectURL(await res.blob());
          const audio = new Audio(clip.url);
          await new Promise<void>((resolve) => { audio.onloadedmetadata = () => resolve(); audio.onerror = () => resolve(); });
          clip.seconds = Number.isFinite(audio.duration) ? Math.round(audio.duration * 10) / 10 : undefined;
        }
      } catch {
        clip.error = "Network error.";
      }
      setClips([...out]);
    }
    setPending(false);
  }

  function downloadAll() {
    clips.forEach((c, i) => {
      if (!c.url) return;
      setTimeout(() => { const a = document.createElement("a"); a.href = c.url!; a.download = name(c.n); a.click(); }, i * 400);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">AI voice. Turn on the platform&apos;s AI-generated label (TikTok, Instagram, Facebook, YouTube) on any post that uses these clips.</p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.script} className="text-xs uppercase tracking-[0.1em] text-subtle">Script, one line per clip</label>
        <textarea id={ids.script} dir="auto" value={script} onChange={(e) => setScript(e.target.value)} rows={8} maxLength={8000} className={field} placeholder={"المحل مفتوح. وجوجل بيقول مسكّر.\nفالناس بتمرق من قدامه."} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5"><label htmlFor={ids.style} className="text-xs uppercase tracking-[0.1em] text-subtle">Accent</label><select id={ids.style} value={style} onChange={(e) => setStyle(e.target.value)} className={field}>{STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
        <div className="flex flex-col gap-1.5"><label htmlFor={ids.voice} className="text-xs uppercase tracking-[0.1em] text-subtle">Voice</label><select id={ids.voice} value={voice} onChange={(e) => setVoice(e.target.value)} className={field}>{VOICES.map((v) => <option key={v} value={v}>{v}</option>)}</select></div>
        <div className="flex flex-col gap-1.5"><label htmlFor={ids.prefix} className="text-xs uppercase tracking-[0.1em] text-subtle">File name</label><input id={ids.prefix} value={prefix} onChange={(e) => setPrefix(e.target.value)} maxLength={40} className={field} /></div>
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => void generate()} disabled={pending} className={button}>{pending ? "Making clips…" : "Make clips"}</button>
        {clips.some((c) => c.url) && !pending ? <button type="button" onClick={downloadAll} className={button}>Download all</button> : null}
      </div>
      {error ? <StatusMessage tone="error" message={error} /> : null}
      <ol aria-live="polite" className="flex flex-col gap-2">
        {clips.map((c) => (
          <li key={c.n} className="flex flex-col gap-2 rounded-md border border-border bg-elevated p-3">
            <p dir="auto" className="text-sm text-foreground"><span className="text-subtle">{c.n}.</span> {c.text}</p>
            {c.url ? (
              <div className="flex flex-wrap items-center gap-3">
                <audio controls src={c.url} className="h-9" />
                <a href={c.url} download={name(c.n)} className="text-xs uppercase tracking-[0.08em] text-accent">Download {name(c.n)}</a>
                {c.seconds ? <span className="text-xs text-subtle">{c.seconds}s</span> : null}
              </div>
            ) : c.error ? <p className="text-xs text-danger">{c.error}</p> : <p className="text-xs text-subtle">Waiting…</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
