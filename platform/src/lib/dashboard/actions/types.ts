/**
 * The consistent, serializable return shape every Step 5B server action
 * uses instead of throwing — client components render `fieldErrors`
 * inline next to the offending input and `message` in a live region,
 * mirroring the existing HTTP error envelope's `{code, message}` shape
 * (Step 4B) rather than inventing a second convention. A mutation that
 * succeeds and doesn't redirect returns `{ ok: true }`; the calling page's
 * data is refreshed via `revalidatePath`, not by trusting client state.
 */
export type ActionResult =
  | { ok: true }
  | { ok: false; code: string; message: string; fieldErrors?: Record<string, string[]> };
