import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession, ADMIN_COOKIE } from "@/lib/admin-session";

// Belt-and-braces on top of each route's own notFound() call, which renders
// correct not-found content but — being thrown from inside an async Server
// Component rather than resolved before rendering starts — does not reliably
// carry a 404 HTTP status. This runs before any rendering, so the status is
// guaranteed correct.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /dev/* must never be reachable in production, not merely show 404-looking
  // content at status 200.
  if (process.env.NODE_ENV === "production" && pathname.startsWith("/dev/")) {
    return new NextResponse(null, { status: 404 });
  }

  // Order management. Refused before any render, so an unauthenticated
  // request never reaches a page that would query orders. The sign-in page
  // itself must stay reachable. Each admin page and Server Action re-checks
  // independently — this is defence in depth, not the only gate.
  if (pathname.startsWith("/admin") && pathname !== "/admin") {
    if (!verifySession(request.cookies.get(ADMIN_COOKIE)?.value)) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
  }

  // Order confirmations are addressed by an unguessable UUID. Anything that
  // isn't UUID-shaped is a probe — most obviously someone trying the visible
  // AR-YYYYMMDD-XXXX order number — and is rejected here with a real 404
  // before it reaches the database. A well-formed but unknown UUID still
  // renders not-found content and exposes no order data.
  if (pathname.startsWith("/order/")) {
    const token = pathname.slice("/order/".length).split("/")[0];
    if (!UUID.test(token)) {
      return new NextResponse(null, { status: 404 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dev/:path*", "/order/:path*", "/admin/:path*"],
};
