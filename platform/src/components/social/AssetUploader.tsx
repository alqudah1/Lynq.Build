"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime";

/**
 * Uploads a file to the real assets API (private Blob storage), then
 * attaches the new asset to this post through the server action. Nothing
 * is shown as attached until both calls succeed.
 */
export function AssetUploader({ organizationId, brandProfileId, contentItemId, contentVariantId, platform, revision, attach }: { organizationId: string; revision: number; brandProfileId: string | null; contentItemId: string; contentVariantId: string; platform: string; attach: (formData: FormData) => Promise<ActionResult> }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const fileId = useId();
  const altId = useId();
  const [alt, setAlt] = useState("");

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setMessage({ tone: "error", text: "Choose a file first." });
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("title", file.name.slice(0, 200) || "Upload");
      form.set("assetType", file.type.startsWith("video/") ? "video" : "image");
      if (alt.trim()) form.set("altText", alt.trim().slice(0, 1000));
      if (brandProfileId) form.set("brandProfileId", brandProfileId);
      form.set("contentItemId", contentItemId);
      form.set("contentVariantId", contentVariantId);
      form.set("platformHint", platform);
      const response = await fetch(`/api/organizations/${organizationId}/social/assets`, { method: "POST", body: form, cache: "no-store", credentials: "same-origin" });
      const body = (await response.json().catch(() => null)) as { data?: { id?: string }; error?: { message?: string } } | null;
      if (!response.ok || !body?.data?.id) {
        setMessage({ tone: "error", text: body?.error?.message ?? "Upload failed." });
        return;
      }
      const attachForm = new FormData();
      attachForm.set("assetId", body.data.id);
      attachForm.set("expectedRevision", String(revision));
      const result = await attach(attachForm);
      if (!result.ok) {
        setMessage({ tone: "error", text: `Uploaded, but not attached: ${result.message}` });
        router.refresh();
        return;
      }
      if (fileRef.current) fileRef.current.value = "";
      setAlt("");
      setMessage({ tone: "success", text: "Uploaded and attached." });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "Network error — nothing was uploaded." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={fileId} className="text-xs uppercase tracking-[0.1em] text-subtle">Upload image or video</label>
      <input id={fileId} ref={fileRef} type="file" accept={ACCEPT} disabled={pending} className="min-h-11 text-sm text-muted file:mr-3 file:min-h-11 file:rounded-sm file:border file:border-border file:bg-elevated file:px-4 file:text-xs file:uppercase file:tracking-[0.08em] file:text-foreground" />
      <label htmlFor={altId} className="sr-only">Alt text</label>
      <input id={altId} value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={1000} placeholder="Alt text (describe the image)" disabled={pending} className="lynq-transition min-h-11 rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground placeholder:text-subtle hover:border-border-strong focus-visible:border-accent/60" />
      <button type="button" onClick={() => void upload()} disabled={pending} className="lynq-glass lynq-transition inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-sm px-5 text-xs font-medium uppercase tracking-[0.08em] text-foreground hover:border-border-strong disabled:opacity-50 sm:w-auto">
        {pending ? "Uploading…" : "Upload & attach"}
      </button>
      {message ? <StatusMessage tone={message.tone} message={message.text} /> : null}
    </div>
  );
}
