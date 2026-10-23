import { NextResponse, type NextRequest } from "next/server";

// Session cookies set by the API (backend/app/config.py). The proxy only checks
// that they exist; the app shell still verifies the session with /api/v1/me.
const SESSION_COOKIES = ["qn_at", "qn_rt"];

/**
 * Send signed-in visitors from the landing and auth pages straight to the app.
 *
 * `?reauth=1` skips the redirect. The app shell adds it when the session check
 * failed but cookies may still be present, so it can never bounce back here.
 */
export function proxy(request: NextRequest) {
  if (request.nextUrl.searchParams.has("reauth")) {
    return NextResponse.next();
  }
  const signedIn = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (!signedIn) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL("/notes", request.url));
}

export const config = {
  matcher: ["/", "/sign-in", "/sign-up"],
};
