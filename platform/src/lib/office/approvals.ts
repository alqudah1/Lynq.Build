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
