export type JarvisStepState = "queued" | "running" | "waiting" | "failed" | "needs_approval" | "completed";

export const JARVIS_STATE_LABELS: Record<JarvisStepState, string> = {
  queued: "Queued",
  running: "In progress",
  waiting: "Waiting its turn",
  failed: "Needs attention",
  needs_approval: "Needs your approval",
  completed: "Done",
};

export function extractFounderDirective(description: string | null): string | null {
  if (!description?.startsWith("Founder directive")) return null;
  const body = description.slice("Founder directive".length).trim();
  return (body.split(/\n\nExecutive Assistant kickoff/i)[0]?.trim() || null);
}

export function extractEngineeringLinks(content: string | null): { pullRequestUrl: string | null; previewUrl: string | null } {
  if (!content) return { pullRequestUrl: null, previewUrl: null };
  const pullRequestUrl = content.match(/- Pull request:\s*(https?:\/\/\S+)/i)?.[1] ?? null;
  const previewValue = content.match(/- Preview:\s*(https?:\/\/\S+)/i)?.[1] ?? null;
  return { pullRequestUrl, previewUrl: previewValue };
}

export function jarvisRecommendation(state: string): string {
  switch (state) {
    case "needs_approval":
      return "Review the approval request. Jarvis will not continue the gated action until you decide.";
    case "failed":
      return "Open the step that needs attention, review the recorded reason, and decide whether Jarvis should retry or change direction.";
    case "completed":
      return "Review the completed deliverables, then archive the project or give Jarvis the next objective.";
    case "running":
      return "Let the active employee finish. Jarvis is tracking the handoff and will surface the next decision automatically.";
    default:
      return "The work is queued. Jarvis will start each handoff when its dependencies are ready.";
  }
}

/* ------------------------------------------------------------------ */
/* Failures, in the founder's language                                 */
/* ------------------------------------------------------------------ */

export type JarvisFailure = {
  /** What happened, in one short sentence a non-engineer can act on. */
  headline: string;
  /** Why it happened. */
  detail: string;
  /** What the founder can do about it. */
  nextStep: string;
  /** The original message, kept so nothing is hidden from someone who wants it. */
  technical: string;
};

const FAILURE_PATTERNS: Array<[RegExp, Omit<JarvisFailure, "technical">]> = [
  [/waiting for the founder to approve the restaurant/i, {
    headline: "Jarvis is waiting for your decision on the restaurant",
    detail: "Nothing is built for a prospect until you have approved that prospect and the evidence gathered for it.",
    nextStep: "Open the approval and approve the restaurant, or ask Jarvis to research a different one.",
  }],
  [/evidence on this project has changed since you approved it/i, {
    headline: "The evidence changed after you approved it",
    detail: "Jarvis gathered the restaurant's public information again, so what it would build from is no longer what you saw.",
    nextStep: "Review the new evidence and approve it, so Jarvis is building from something you have read.",
  }],
  [/no approved evidence version recorded/i, {
    headline: "There is no approved evidence to build from",
    detail: "This prospect has no approved set of public information attached to it, so Jarvis has nothing it is allowed to use.",
    nextStep: "Ask Jarvis to gather the evidence again, then approve it.",
  }],
  [/approved evidence is no longer on this project/i, {
    headline: "The approved evidence is missing from the project",
    detail: "The record Jarvis was going to build from is no longer attached to this project.",
    nextStep: "Ask Jarvis to gather the evidence again, then approve it.",
  }],
  [/brand pack .*malformed|malformed.*brand pack/i, {
    headline: "The stored evidence could not be read",
    detail: "The saved record of the restaurant's public information is damaged, so Jarvis refused to use any of it rather than use part of it.",
    nextStep: "Ask Jarvis to gather the evidence again.",
  }],
  [/did not pass validation/i, {
    headline: "The generated site did not pass Jarvis's own checks",
    detail: "Jarvis builds the site and then checks it — for dead links, unfinished copy, and anything the evidence does not support. This attempt failed those checks, so it was not delivered.",
    nextStep: "Look at the listed problems. Most are fixed by better evidence; ask Jarvis to try again once you have approved it.",
  }],
  [/website generation provider failed/i, {
    headline: "The service that writes the site copy did not respond",
    detail: "This is an outage on the model provider's side, not a problem with the restaurant or the evidence.",
    nextStep: "Ask Jarvis to try again in a few minutes.",
  }],
  [/already belongs to project/i, {
    headline: "That demo address is already taken by another project",
    detail: "Jarvis refused to overwrite a demo that belongs to a different project rather than replace someone else's preview.",
    nextStep: "Tell Jarvis to use a new project for this prospect.",
  }],
  [/waiting for the preview link|preview deployment had not appeared/i, {
    headline: "The preview has not appeared yet",
    detail: "The code is committed, but the hosted preview it points at is not live, so there is nothing to open and approve.",
    nextStep: "Give the deployment a few minutes, then refresh. If it never appears, the deployment itself failed.",
  }],
  [/Resend email connection/i, {
    headline: "Email is not connected",
    detail: "Jarvis has an approved message ready but no connected email account to send it from.",
    nextStep: "Connect an email account in Communications, then approve the message again.",
  }],
  [/verified public business email/i, {
    headline: "No public email address was verified for this restaurant",
    detail: "Jarvis will not guess an address, so there is nowhere it is allowed to send the approved message.",
    nextStep: "Add the address yourself if you know it, or ask Jarvis to choose a different prospect.",
  }],
  [/GitHub request failed|connector must be installed/i, {
    headline: "Jarvis cannot reach the code repository",
    detail: "The GitHub connection the Office uses to open pull requests is unavailable or points at the wrong repository.",
    nextStep: "Check the GitHub connection in settings, then ask Jarvis to try again.",
  }],
  [/Feature branch push failed/i, {
    headline: "The work could not be pushed",
    detail: "The site was generated and committed inside the sandbox, but pushing the branch to GitHub failed.",
    nextStep: "Ask Jarvis to try again; if it keeps failing, the repository connection needs attention.",
  }],
  [/changed files outside its own route/i, {
    headline: "The generated site tried to change files it should not",
    detail: "Jarvis stopped the delivery rather than let a prospect demo touch anything beyond its own page.",
    nextStep: "This is a bug worth reporting. Nothing was pushed.",
  }],
  [/identical to the base branch/i, {
    headline: "Nothing changed since the last build",
    detail: "Regenerating produced exactly the site that is already there, so there was nothing new to deliver.",
    nextStep: "Approve the existing demo, or change the evidence first.",
  }],
];

/**
 * Turn whatever the runtime recorded into something a founder can act on
 * without reading a stack trace. The original text is always carried
 * along: making failures legible must never mean hiding them.
 */
export function explainJarvisFailure(raw: string | null | undefined): JarvisFailure | null {
  const message = raw?.trim();
  if (!message) return null;
  for (const [pattern, explanation] of FAILURE_PATTERNS) {
    if (pattern.test(message)) return { ...explanation, technical: message };
  }
  return {
    headline: "This step stopped and needs a look",
    detail: message.length > 400 ? `${message.slice(0, 400)}…` : message,
    nextStep: "Open the step's evidence to see what it was doing, then decide whether Jarvis should retry.",
    technical: message,
  };
}

/* ------------------------------------------------------------------ */
/* Is the demo actually built?                                         */
/* ------------------------------------------------------------------ */

export type DemoDeliverySummary = {
  /** True only when the route, the commit and a working preview all exist. */
  built: boolean;
  route: string | null;
  commitSha: string | null;
  previewUrl: string | null;
  pullRequestUrl: string | null;
  /** Plain-language list of what is still missing. Empty when built. */
  missing: string[];
};

const ENGINEERING_RESULT = /<!-- LYNQ_ENGINEERING_RESULT ([\s\S]*?) -->/g;

/**
 * Read the machine-readable delivery record rather than the prose around
 * it. Jarvis may only call a demo built when the route, the commit and a
 * preview that was actually observed are all present; anything less is
 * reported as unfinished, with the missing pieces named.
 */
export function summarizeDemoDelivery(content: string | null): DemoDeliverySummary {
  const empty: DemoDeliverySummary = { built: false, route: null, commitSha: null, previewUrl: null, pullRequestUrl: null, missing: [] };
  if (!content) return empty;
  // The LAST delivery, not the first.
  //
  // This reads a single artifact in one caller and the whole project's
  // shared context in another, and a founder who requests changes leaves
  // two delivery records on that project — oldest first. Taking the first
  // match meant the run report, the "is it built" decision and the preview
  // link a founder was handed all described the build he had already
  // rejected.
  const markers = [...content.matchAll(ENGINEERING_RESULT)];
  let parsed: Record<string, unknown> | null = null;
  for (const marker of markers.reverse()) {
    try {
      const candidate = JSON.parse(marker[1] ?? "") as Record<string, unknown>;
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        parsed = candidate;
        break;
      }
    } catch {
      // A damaged marker is skipped rather than hiding an intact older one.
    }
  }
  if (!parsed) return empty;
  const text = (key: string) => (typeof parsed[key] === "string" && parsed[key] ? (parsed[key] as string) : null);
  const route = text("previewPath");
  const commitSha = text("commitSha");
  const previewUrl = text("previewUrl");
  const previewReady = parsed.previewStatus === "ready" && Boolean(previewUrl);
  const missing: string[] = [];
  if (!route) missing.push("the public demo page");
  if (!commitSha) missing.push("a commit");
  if (!previewReady) missing.push("a working preview link");
  return {
    built: missing.length === 0,
    route,
    commitSha,
    previewUrl: previewReady ? previewUrl : null,
    pullRequestUrl: text("pullRequestUrl"),
    missing,
  };
}
