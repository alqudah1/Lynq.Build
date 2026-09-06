import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Belt-and-braces on top of app/dev/3d-test/page.tsx's own notFound() call
// (which renders correct not-found content but, being thrown from inside an
// async Server Component rather than resolved before rendering starts, does
// not reliably carry a 404 HTTP status). This runs before any rendering, so
// the status code itself is guaranteed correct — /dev/* must never be
// reachable in production, not just show 404-looking content at status 200.
export function proxy(request: NextRequest) {
  if (process.env.NODE_ENV === "production" && request.nextUrl.pathname.startsWith("/dev/")) {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/dev/:path*",
};
