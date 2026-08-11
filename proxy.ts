import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/config";

/**
 * Route-level gate: every page in this app requires a session except
 * /login itself. This only checks "is someone logged in?" — matter-level
 * authorization (who can see which matter) happens server-side per
 * request in app/(dashboard)/matters/[matterId]/layout.tsx, since that
 * decision needs a specific matterId and a DB lookup that doesn't belong
 * in a proxy that runs on every request (see CLAUDE.md, section 4.4).
 */
export default auth((req) => {
  const isLoggedIn = Boolean(req.auth);
  // /login/mfa and /login/mfa/setup are reached with a signed pending-
  // challenge cookie, not a session (see lib/auth/mfa/tickets.ts) —
  // /login/change-password is reached the same pre-session way, just
  // without a ticket (see lib/auth/login-flow.ts) — all three belong in
  // the same pre-session bucket as /login itself.
  const isLoginPage =
    req.nextUrl.pathname === "/login" ||
    req.nextUrl.pathname === "/login/mfa" ||
    req.nextUrl.pathname.startsWith("/login/mfa/") ||
    req.nextUrl.pathname === "/login/change-password";

  if (!isLoggedIn && !isLoginPage) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  // `brand` is excluded alongside the existing framework/static exclusions
  // because it's a public asset folder (public/brand) — the login page
  // itself renders before a session exists, so its logo <img> must be
  // fetchable without auth. No application route is affected. `api/health`
  // is excluded because a host's uptime probe has no session cookie to
  // send — the route itself returns no sensitive data (see its handler).
  matcher: ["/((?!api/auth|api/health|_next/static|_next/image|favicon.ico|brand).*)"],
};
