/**
 * Dispatch failure codes, in words a founder can act on.
 *
 * The codes themselves are written for a log — `model_rate_limited`,
 * `no_agents_available`, `unknown_error` — and rendering them raw produced
 * sentences like "It failed (model rate limited). Nothing was started." on a
 * screen whose whole point is that a non-technical reader can act on what it
 * says.
 *
 * This lives on its own, rather than beside either surface that needs it,
 * because there are two: the Jarvis screen renders the failure on a command
 * card, and the decision route composes the sentence returned when an approval
 * is acted on. The component had a mapping and the route did not, so the code
 * leaked through the one surface the component's test could not see — which is
 * exactly what happens when the same idea is written down twice.
 *
 * Not `server-only`: the client component imports it too.
 */
export const DISPATCH_FAILURE_LABELS: Record<string, string> = {
  model_rate_limited: "Jarvis's planner was busy",
  provider_unreachable: "Jarvis could not reach the planner",
  timed_out: "it took too long and Jarvis stopped waiting",
  no_agents_available: "there was no one on the team free to take it",
  authorization_failed: "Jarvis was not allowed to open it",
  resource_not_found: "something it needed was missing",
  attempts_exhausted: "it has been tried as many times as it can be",
  partially_created: "the handoff stopped part-way",
  stalled: "it stopped part-way",
  unknown_error: "an unexpected problem",
};

/** Never returns a code. An unmapped one reads as the honest generic rather than as jargon. */
export function describeDispatchFailure(code: string | null | undefined): string {
  if (!code) return "an unexpected problem";
  return DISPATCH_FAILURE_LABELS[code] ?? "an unexpected problem";
}
