import { PLATFORM_SHORT_LABEL, initials } from "./format";

export interface PreviewMedia {
  id: string;
  contentType: string;
  previewUrl: string;
  title: string;
}

/**
 * A faithful-enough rendering of how the post will read on its platform:
 * account header (initials avatar — no fake profile photo), the hook and
 * body with real line breaks, hashtags, CTA/link, and the attached media
 * streamed from the authenticated assets API. Shows nothing it does not
 * have — an empty body says so instead of lorem ipsum.
 */
export function PlatformPreview({
  platform,
  brandName,
  accountName,
  hook,
  body,
  hashtags,
  callToAction,
  linkUrl,
  media,
  format,
  compact = false,
}: {
  platform: string;
  brandName: string | null;
  accountName: string | null;
  hook: string;
  body: string;
  hashtags: string[];
  callToAction?: string;
  linkUrl?: string | null;
  media: PreviewMedia[];
  format: string;
  compact?: boolean;
}) {
  const name = accountName ?? brandName ?? "Your account";
  const first = media[0];
  const isVideo = first?.contentType.startsWith("video/");
  const verticalFormats = ["story", "reel", "short_video"];
  // The preview never crops: Instagram feed images are 4:5, vertical formats 9:16 (capped in height on tall screens), the rest 4:3.
  const aspect = verticalFormats.includes(format) ? "aspect-[9/16] max-h-[28rem]" : platform === "instagram" ? "aspect-[4/5]" : "aspect-[4/3]";
  const mediaFirst = platform === "instagram" || platform === "tiktok" || platform === "youtube";
  const hasText = Boolean(hook.trim() || body.trim());

  const mediaBlock = first ? (
    <div className={`relative w-full overflow-hidden rounded-sm bg-black ${aspect}`}>
      {isVideo ? (
        <video controls preload="metadata" src={first.previewUrl} className="h-full w-full object-contain" aria-label={first.title} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- private asset streamed from the authenticated assets API; no image loader applies.
        <img src={first.previewUrl} alt={first.title} loading="lazy" decoding="async" className="h-full w-full object-contain" />
      )}
      {media.length > 1 ? <span className="absolute right-2 top-2 rounded-sm bg-background/80 px-2 py-0.5 text-[0.65rem] text-foreground">1 / {media.length}</span> : null}
    </div>
  ) : null;

  return (
    <figure aria-label={`${PLATFORM_SHORT_LABEL[platform] ?? platform} preview`} className="flex flex-col gap-3 rounded-md border border-border bg-background p-4">
      <figcaption className="flex items-center gap-3">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border-strong bg-elevated-2 text-xs font-semibold text-foreground">
          {initials(brandName ?? accountName)}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-foreground">{name}</span>
          <span className="text-xs text-subtle">{PLATFORM_SHORT_LABEL[platform] ?? platform} · {format.replaceAll("_", " ")}</span>
        </span>
      </figcaption>

      {mediaFirst ? mediaBlock : null}

      {hasText ? (
        <div className={`flex flex-col gap-2 text-sm leading-6 text-foreground ${compact ? "line-clamp-6" : ""}`}>
          {hook.trim() ? <p className="font-medium">{hook}</p> : null}
          {body.trim() ? <p className="whitespace-pre-line text-foreground/90">{body}</p> : null}
        </div>
      ) : (
        <p className="text-sm text-subtle">No caption yet.</p>
      )}

      {hashtags.length ? <p className="text-sm text-info">{hashtags.join(" ")}</p> : null}
      {callToAction?.trim() || linkUrl ? (
        <div className="flex flex-col gap-1 rounded-sm border border-border px-3 py-2 text-xs">
          {callToAction?.trim() ? <span className="text-foreground">{callToAction}</span> : null}
          {linkUrl ? <span className="truncate text-subtle">{linkUrl}</span> : null}
        </div>
      ) : null}

      {!mediaFirst ? mediaBlock : null}
      {!first && ["image", "carousel", "story", "reel", "short_video", "video"].includes(format) ? <p className="rounded-sm border border-dashed border-border px-3 py-6 text-center text-xs text-subtle">No media attached yet</p> : null}
    </figure>
  );
}
