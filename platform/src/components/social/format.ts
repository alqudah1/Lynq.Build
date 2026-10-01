import type { BadgeTone } from "@/components/ui/Badge";

/**
 * Module 19 UI — pure display helpers shared by the Social pages (server)
 * and their few client components. Status tones only ever express a real
 * state; nothing here is decoration.
 */

export const VARIANT_STATUS_TONE: Record<string, BadgeTone> = {
  idea: "neutral",
  draft: "neutral",
  generating: "info",
  ready_for_review: "warning",
  changes_requested: "warning",
  approved: "success",
  scheduled: "info",
  publishing: "info",
  published: "success",
  failed: "danger",
  rejected: "danger",
  archived: "neutral",
};

export const VARIANT_STATUS_LABEL: Record<string, string> = {
  idea: "Idea",
  draft: "Draft",
  generating: "Generating",
  ready_for_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
  scheduled: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  failed: "Failed",
  rejected: "Rejected",
  archived: "Archived",
};

export const CONNECTION_STATUS_TONE: Record<string, BadgeTone> = {
  connected: "success",
  manual: "neutral",
  authorization_required: "warning",
  token_expired: "danger",
  missing_configuration: "warning",
  error: "danger",
  not_supported: "neutral",
  disconnected: "neutral",
};

export const CONNECTION_STATUS_LABEL: Record<string, string> = {
  connected: "Connected",
  manual: "Manual",
  authorization_required: "Authorization needed",
  token_expired: "Token expired",
  missing_configuration: "Not configured",
  error: "Error",
  not_supported: "Not supported",
  disconnected: "Disconnected",
};

export const JOB_STATUS_TONE: Record<string, BadgeTone> = {
  queued: "neutral",
  processing: "info",
  published: "success",
  failed: "danger",
  retrying: "warning",
  cancelled: "neutral",
};

export const SEVERITY_TONE: Record<string, BadgeTone> = { urgent: "danger", attention: "warning", info: "info" };

/** Short glyph per platform for compact calendar chips (always paired with a text label elsewhere). */
export const PLATFORM_GLYPH: Record<string, string> = { facebook: "FB", instagram: "IG", linkedin: "IN", tiktok: "TT", youtube: "YT", x: "X" };

export const PLATFORM_SHORT_LABEL: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", tiktok: "TikTok", youtube: "YouTube", x: "X" };

export function humanize(value: string): string {
  const text = value.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts[parts.length - 1][0]}`).toUpperCase();
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDateTime(value: Date | string | null | undefined, timeZone: string): string {
  const d = toDate(value);
  if (!d) return "Not set";
  return new Intl.DateTimeFormat("en-CA", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}

export function formatDate(value: Date | string | null | undefined, timeZone: string): string {
  const d = toDate(value);
  if (!d) return "Not set";
  return new Intl.DateTimeFormat("en-CA", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(d);
}

export function formatTime(value: Date | string | null | undefined, timeZone: string): string {
  const d = toDate(value);
  if (!d) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone, hour: "numeric", minute: "2-digit" }).format(d);
}

function zonedFields(d: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { year: get("year"), month: get("month"), day: get("day"), hour: String(Number(get("hour")) % 24).padStart(2, "0"), minute: get("minute") };
}

/** `YYYY-MM-DD` of an instant in `timeZone`. */
export function localDayKey(value: Date | string, timeZone: string): string {
  const d = toDate(value) ?? new Date();
  const f = zonedFields(d, timeZone);
  return `${f.year}-${f.month}-${f.day}`;
}

/** `YYYY-MM-DDTHH:mm` for a `<input type="datetime-local">`, expressed in `timeZone`. */
export function toDateTimeLocalValue(value: Date | string | null | undefined, timeZone: string): string {
  const d = toDate(value);
  if (!d) return "";
  const f = zonedFields(d, timeZone);
  return `${f.year}-${f.month}-${f.day}T${f.hour}:${f.minute}`;
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "USD", maximumFractionDigits: value < 1 ? 4 : 2 }).format(value);
}

/** Builds an app link under the Social section, carrying the selected brand. */
export function socialHref(organizationSlug: string, path: string, params: Record<string, string | null | undefined> = {}): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
  const qs = search.toString();
  return `/app/${organizationSlug}${clean}${qs ? `${clean.includes("?") ? "&" : "?"}${qs}` : ""}`;
}

/** Attention items carry service paths; a few map onto this pass's route names. */
export function resolveAttentionPath(path: string): string {
  if (path === "/social/studio") return "/social/create";
  return path;
}

// ---------------------------------------------------------------------------
// UI pass 2 — numbers (null always renders "—", never 0) and status tones
// ---------------------------------------------------------------------------

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-CA").format(value);
}

/** Signed change, e.g. "+120" / "−8"; null → "—". */
export function formatChange(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${new Intl.NumberFormat("en-CA").format(Math.abs(value))}`;
}

/** A fraction (0.0423) as a percentage ("4.23%"); null → "—". */
export function formatRate(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

/** Integer minor units (cents) in `currency`; null → "—". Fractional minor units (derived CPC/CPM) keep two decimals. */
export function formatMinor(value: number | null | undefined, currency: string | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const major = value / 100;
  if (!currency) return major.toFixed(2);
  try {
    return new Intl.NumberFormat("en-CA", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency}`;
  }
}

export const ENGAGEMENT_STATUS_TONE: Record<string, BadgeTone> = {
  new: "info",
  needs_reply: "warning",
  reply_drafted: "accent",
  replied: "success",
  ignored: "neutral",
  hidden: "neutral",
  escalated: "danger",
};

export const ENGAGEMENT_STATUS_LABEL: Record<string, string> = {
  new: "New",
  needs_reply: "Needs reply",
  reply_drafted: "Reply drafted",
  replied: "Replied",
  ignored: "Ignored",
  hidden: "Hidden",
  escalated: "Escalated",
};

export const SENTIMENT_TONE: Record<string, BadgeTone> = { positive: "success", neutral: "neutral", negative: "danger", mixed: "warning" };

export const AD_CHANGE_STATUS_TONE: Record<string, BadgeTone> = {
  proposed: "neutral",
  pending_approval: "warning",
  approved: "info",
  rejected: "danger",
  executing: "info",
  executed: "success",
  failed: "danger",
  cancelled: "neutral",
};

export const AD_CHANGE_STATUS_LABEL: Record<string, string> = {
  proposed: "Proposed",
  pending_approval: "Awaiting approval",
  approved: "Approved — queued",
  rejected: "Rejected",
  executing: "Executing",
  executed: "Executed",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Connection Center tones: only a verified connection is green; anything that needs a person to reconnect is a warning. */
export const ACCOUNT_STATUS_TONE: Record<string, BadgeTone> = {
  connected: "success",
  authorization_required: "warning",
  token_expired: "warning",
  error: "danger",
  missing_configuration: "neutral",
  not_supported: "neutral",
  manual: "neutral",
  disconnected: "neutral",
};

/** Raw ISO-like dates for tables: "Oct 1, 2026". */
export function formatShortDate(value: Date | string | null | undefined, timeZone: string): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "short", day: "numeric" }).format(d);
}
