import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/config";

/** The shape every authorization helper in lib/auth/authorization.ts expects. */
export type SessionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  role: import("@prisma/client").UserRole;
};

export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  return session?.user ?? null;
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
