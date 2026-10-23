import { prisma } from "@/lib/db";
import { recordActivity } from "@/lib/usage/record";

/**
 * UserSession lifecycle. A row is created when Auth.js issues the JWT at
 * sign-in (lib/auth/config.ts) and its id rides in the token as `sid`.
 * Every function here swallows its own errors — session analytics must
 * never block or break sign-in, sign-out, or a request.
 */

/** Matches the JWT maxAge in lib/auth/config.ts: a session unseen for this long has expired. */
export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export async function startUserSession(userId: string): Promise<string | null> {
  try {
    const session = await prisma.userSession.create({ data: { userId } });
    await recordActivity({ userId, sessionId: session.id, type: "LOGIN_SUCCESS", module: "account" });
    await recordActivity({ userId, sessionId: session.id, type: "SESSION_START", module: "account" });
    return session.id;
  } catch {
    return null;
  }
}

export async function endUserSession(
  sessionId: string | null | undefined,
  userId: string | null | undefined,
  reason: "LOGOUT" | "REVOKED",
): Promise<void> {
  if (!sessionId || !userId) return;
  try {
    const now = new Date();
    const { count } = await prisma.userSession.updateMany({
      where: { id: sessionId, userId, endedAt: null },
      data: { endedAt: now, endReason: reason, lastSeenAt: now },
    });
    if (count > 0 && reason === "LOGOUT") {
      await recordActivity({ userId, sessionId, type: "LOGOUT", module: "account" });
    }
  } catch {
    // never block sign-out
  }
}

/** Touches lastSeenAt on an open session belonging to this user (ownership is part of the filter). */
export async function touchUserSession(sessionId: string | null | undefined, userId: string): Promise<void> {
  if (!sessionId) return;
  try {
    await prisma.userSession.updateMany({
      where: { id: sessionId, userId, endedAt: null },
      data: { lastSeenAt: new Date() },
    });
  } catch {
    // analytics only
  }
}

/**
 * Lazily marks sessions EXPIRED once nothing has been seen from them for the
 * JWT lifetime. The recorded end is the last time the session was actually
 * seen — the best known end, not the moment this ran.
 */
export async function expireStaleSessions(now = new Date()): Promise<number> {
  try {
    const cutoff = new Date(now.getTime() - SESSION_MAX_AGE_MS);
    const stale = await prisma.userSession.findMany({
      where: { endedAt: null, lastSeenAt: { lt: cutoff } },
      select: { id: true, userId: true, lastSeenAt: true },
      take: 500,
    });
    for (const session of stale) {
      await prisma.userSession.updateMany({
        where: { id: session.id, endedAt: null },
        data: { endedAt: session.lastSeenAt, endReason: "EXPIRED" },
      });
      await recordActivity({ userId: session.userId, sessionId: session.id, type: "SESSION_EXPIRED", module: "account" });
    }
    return stale.length;
  } catch {
    return 0;
  }
}
