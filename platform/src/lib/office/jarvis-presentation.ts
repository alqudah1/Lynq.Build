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
