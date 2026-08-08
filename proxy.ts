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
  const isLoginPage = req.nextUrl.pathname === "/login";

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
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
