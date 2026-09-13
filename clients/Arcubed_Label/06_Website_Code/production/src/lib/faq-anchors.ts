/**
 * Stable ids for the FAQ's question groups.
 *
 * Shared by the FAQ page, which stamps them onto each <section>, and the
 * footer, whose Orders and shipping links point at the group that answers
 * them rather than at the top of the page. One function so a renamed group
 * cannot leave the footer pointing at an anchor that no longer exists.
 */
export function faqAnchor(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
