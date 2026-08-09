import { checkHealth } from "@/lib/health-check";

// Guarantees this route is never statically cached and always executes
// at request time, even though it doesn't use any Request-time API itself
// (see Next.js's route-segment-config `dynamic` option).
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await checkHealth();
  const httpStatus =
    result.status === "ok" ? 200 : result.database === "unreachable" ? 503 : 500;

  // `dynamic = "force-dynamic"` controls Next's rendering/caching behavior,
  // but route handlers don't automatically receive the same strict
  // Cache-Control header a page does — set it explicitly so no
  // intermediate cache (CDN, proxy, browser) can ever store this response.
  return Response.json(result, {
    status: httpStatus,
    headers: { "Cache-Control": "no-store, must-revalidate" },
  });
}
