import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db";

/** The shape every authorization helper in lib/auth/authorization.ts expects. */
export type SessionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  role: import("@prisma/client").UserRole;
};

/**
 * Resolves the current session, re-verified against the database on every
 * call rather than trusting the JWT's `role`/identity claims for the
 * session's full lifetime. This is what actually closes the gap
 * docs/SECURITY.md previously flagged as deliberately deferred: a JWT
 * session is not otherwise revocable server-side before it expires, so an
 * admin deactivating/demoting a user (lib/admin/users/actions.ts) would
 * otherwise leave that user's existing session valid for up to 12 hours.
 *
 * `sessionStamp` (carried in the JWT since sign-in, see
 * lib/auth/config.ts) is compared against the account's *current*
 * `sessionInvalidatedAt` — every sensitive admin/matter-team action that
 * should end an already-issued session bumps that column (see
 * lib/admin/users/actions.ts). A session issued before the most recent
 * bump is treated as signed out, exactly as if it didn't exist; a session
 * issued after is unaffected by an older bump. `role` is always read fresh
 * from the database here too, so a role change takes effect on this
 * account's very next request, not at next login.
 *
 * The trade-off is one extra DB read per authenticated request — a
 * deliberate choice (see docs/SECURITY.md's "Authentication" section),
 * consistent with how this app already does per-request DB reads for
 * matter-assignment authorization (lib/auth/access.ts).
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user) return null;

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, status: true, sessionInvalidatedAt: true },
  });
  if (!dbUser || dbUser.status !== "ACTIVE") return null;

  const invalidatedAt = dbUser.sessionInvalidatedAt?.getTime() ?? 0;
  // `?? 0`: a session cookie issued before this feature shipped has no
  // `sessionStamp` claim at all (`undefined`, despite the type), and
  // `invalidatedAt > undefined` is always `false` in JS — a silent
  // fail-open that would let such a session survive an admin's
  // deactivation/reset indefinitely. Treating a missing stamp as the
  // oldest possible one means it's trusted only until this account's
  // first-ever invalidation bump, exactly the behavior a stamped session
  // already gets.
  if (invalidatedAt > (session.user.sessionStamp ?? 0)) return null;

  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: dbUser.role,
  };
}

/**
 * Fetches the current user or redirects to /login. `proxy.ts` already
 * blocks unauthenticated requests to every protected route, but every
 * Server Component that reads case data checks again independently (see
 * CLAUDE.md, section 4.4) rather than trusting the proxy alone.
 */
export async function requireCurrentUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}
