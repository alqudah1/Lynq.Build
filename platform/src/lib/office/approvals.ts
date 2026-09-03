/**
 * Approval action names shared between the code that requests founder
 * approval and the code that refuses to act without it. They are constants
 * rather than string literals precisely because a typo in either place
 * would silently turn a gate into a no-op.
 */

/** The founder chose this restaurant. Nothing may be built for a prospect before this is approved. */
export const RESTAURANT_PROSPECT_APPROVAL_ACTION = "restaurant_prospect_selection";

/** The founder accepted the built demo. Required before the outreach stage may draft anything. */
export const DEMO_APPROVAL_ACTION = "office_demo_approval";

/** The founder approved this exact email. Required before a single message is queued. */
export const RESTAURANT_OUTREACH_APPROVAL_ACTION = "send_restaurant_outreach";

type RestaurantIdentity = {
  name: string;
  address: string;
  city: string;
  countryCode: string;
  website: string | null;
};

function normalizedIdentityPart(value: string | null): string {
  return (value ?? "")
    .trim()
    .toLocaleLowerCase("en-CA")
    .replace(/\s+/g, " ")
    .replace(/\/$/, "");
}

/** Approvals bind to a physical business identity, not merely a display name. */
export function isSameRestaurantIdentity(approved: RestaurantIdentity, candidate: RestaurantIdentity): boolean {
  return (
    normalizedIdentityPart(approved.name) === normalizedIdentityPart(candidate.name)
    && normalizedIdentityPart(approved.address) === normalizedIdentityPart(candidate.address)
    && normalizedIdentityPart(approved.city) === normalizedIdentityPart(candidate.city)
    && normalizedIdentityPart(approved.countryCode) === normalizedIdentityPart(candidate.countryCode)
    && normalizedIdentityPart(approved.website) === normalizedIdentityPart(candidate.website)
  );
}

/** A demo approval is valid only for the exact source commit the founder reviewed. */
export function approvalMatchesDelivery(proposedActionRef: unknown, commitSha: string): boolean {
  if (!proposedActionRef || typeof proposedActionRef !== "object" || Array.isArray(proposedActionRef)) return false;
  const approvedCommit = (proposedActionRef as Record<string, unknown>).commitSha;
  return typeof approvedCommit === "string" && approvedCommit === commitSha;
}

/**
 * A prospect approval covers one exact set of evidence. The fingerprint is
 * recorded on the approval when it is requested, so evidence gathered or
 * edited afterwards produces a different version that this approval
 * provably does not cover — no comparison of contents, and nothing for a
 * later stage to forget to check.
 */
export function approvalMatchesBrandPack(proposedActionRef: unknown, fingerprint: string): boolean {
  if (!proposedActionRef || typeof proposedActionRef !== "object" || Array.isArray(proposedActionRef)) return false;
  const approved = (proposedActionRef as Record<string, unknown>).brandPackFingerprint;
  return typeof approved === "string" && approved === fingerprint;
}
