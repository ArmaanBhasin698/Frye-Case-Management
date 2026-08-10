import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { signTicketId, verifyTicketSignature } from "./crypto";

/**
 * Short-lived, single-use, server-authoritative state for the parts of the
 * MFA flow that happen before a real application session exists, or that
 * must not touch the User row until confirmed. The browser only ever holds
 * a signed reference (`<ticketId>.<signature>`) to an MfaChallengeTicket
 * row — the signature proves the reference wasn't tampered with, but the
 * database row (not the cookie) is the source of truth for whether a
 * ticket is still valid or has been consumed. See prisma/schema.prisma.
 */

const PENDING_COOKIE = "frye_mfa_pending";
const ENROLL_COOKIE = "frye_mfa_enroll";

const PENDING_TTL_MS = 5 * 60 * 1000;
const VERIFIED_TTL_MS = 60 * 1000;
const ENROLL_TTL_MS = 10 * 60 * 1000;

function cookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}

function encodeRef(ticketId: string): string {
  return `${ticketId}.${signTicketId(ticketId)}`;
}

function decodeRef(ref: string | undefined): string | null {
  if (!ref) return null;
  const separatorIndex = ref.lastIndexOf(".");
  if (separatorIndex <= 0) return null;
  const ticketId = ref.slice(0, separatorIndex);
  const signature = ref.slice(separatorIndex + 1);
  return verifyTicketSignature(ticketId, signature) ? ticketId : null;
}

/** Created right after password verification succeeds for an MFA-enabled or MFA-required user. */
export async function createPendingTicket(userId: string): Promise<void> {
  const ticket = await prisma.mfaChallengeTicket.create({
    data: { userId, purpose: "MFA_PENDING", expiresAt: new Date(Date.now() + PENDING_TTL_MS) },
  });
  (await cookies()).set(PENDING_COOKIE, encodeRef(ticket.id), cookieOptions(PENDING_TTL_MS));
}

/**
 * Reads the current pending ticket without consuming it — a user gets
 * several TOTP attempts against the same challenge within its window, so
 * only a *successful* verification consumes it (see `completeChallenge`).
 */
export async function readPendingTicket(): Promise<{ id: string; userId: string } | null> {
  const ticketId = decodeRef((await cookies()).get(PENDING_COOKIE)?.value);
  if (!ticketId) return null;
  const ticket = await prisma.mfaChallengeTicket.findUnique({ where: { id: ticketId } });
  if (!ticket || ticket.purpose !== "MFA_PENDING" || ticket.consumedAt || ticket.expiresAt <= new Date()) {
    return null;
  }
  return { id: ticket.id, userId: ticket.userId };
}

export async function clearPendingTicket(): Promise<void> {
  (await cookies()).delete(PENDING_COOKIE);
}

/**
 * Atomically consumes a pending ticket and mints a one-shot MFA_VERIFIED
 * ticket for the same user. Call only immediately after a real TOTP or
 * recovery-code check has succeeded. The returned id must be passed
 * straight into signIn("mfa-complete", ...) within the same request — it
 * is never sent to the client.
 */
export async function completeChallenge(pendingTicketId: string, userId: string): Promise<string> {
  const consumed = await prisma.mfaChallengeTicket.updateMany({
    where: { id: pendingTicketId, userId, purpose: "MFA_PENDING", consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1) {
    throw new Error("MFA challenge is no longer valid.");
  }
  const verified = await prisma.mfaChallengeTicket.create({
    data: { userId, purpose: "MFA_VERIFIED", expiresAt: new Date(Date.now() + VERIFIED_TTL_MS) },
  });
  return verified.id;
}

/**
 * Atomically consumes an MFA_VERIFIED ticket — this is the only proof the
 * internal "mfa-complete" Credentials provider accepts that a second
 * factor was actually checked. The `WHERE consumedAt IS NULL` guard means a
 * given ticket id can succeed here at most once, no matter how many times
 * or how concurrently it's presented.
 */
export async function consumeVerifiedTicket(ticketId: string): Promise<{ userId: string } | null> {
  const consumed = await prisma.mfaChallengeTicket.updateMany({
    where: { id: ticketId, purpose: "MFA_VERIFIED", consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1) return null;
  const ticket = await prisma.mfaChallengeTicket.findUnique({ where: { id: ticketId }, select: { userId: true } });
  return ticket ? { userId: ticket.userId } : null;
}

/**
 * Starts (or restarts) an in-progress enrollment for `userId`, holding the
 * encrypted pending secret only in this ticket row — never on the User row
 * — so an abandoned enrollment leaves no trace once the ticket expires. Any
 * previous unconsumed enrollment ticket for this user is dropped first.
 */
export async function createEnrollmentTicket(userId: string, encryptedSecret: string): Promise<void> {
  await prisma.mfaChallengeTicket.deleteMany({ where: { userId, purpose: "MFA_ENROLLMENT", consumedAt: null } });
  const ticket = await prisma.mfaChallengeTicket.create({
    data: {
      userId,
      purpose: "MFA_ENROLLMENT",
      payload: encryptedSecret,
      expiresAt: new Date(Date.now() + ENROLL_TTL_MS),
    },
  });
  (await cookies()).set(ENROLL_COOKIE, encodeRef(ticket.id), cookieOptions(ENROLL_TTL_MS));
}

export async function readEnrollmentTicket(
  expectedUserId: string,
): Promise<{ id: string; encryptedSecret: string } | null> {
  const ticketId = decodeRef((await cookies()).get(ENROLL_COOKIE)?.value);
  if (!ticketId) return null;
  const ticket = await prisma.mfaChallengeTicket.findUnique({ where: { id: ticketId } });
  if (
    !ticket ||
    ticket.purpose !== "MFA_ENROLLMENT" ||
    ticket.userId !== expectedUserId ||
    ticket.consumedAt ||
    ticket.expiresAt <= new Date() ||
    !ticket.payload
  ) {
    return null;
  }
  return { id: ticket.id, encryptedSecret: ticket.payload };
}

export async function consumeEnrollmentTicket(ticketId: string, expectedUserId: string): Promise<boolean> {
  const consumed = await prisma.mfaChallengeTicket.updateMany({
    where: {
      id: ticketId,
      userId: expectedUserId,
      purpose: "MFA_ENROLLMENT",
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { consumedAt: new Date() },
  });
  return consumed.count === 1;
}

export async function clearEnrollmentTicket(): Promise<void> {
  (await cookies()).delete(ENROLL_COOKIE);
}
