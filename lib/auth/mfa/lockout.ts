import { prisma } from "@/lib/db";

/**
 * DB-backed (not in-memory) lockout for the MFA second-factor step only —
 * durable across restarts/instances, unlike a per-process counter (see
 * docs/SECURITY.md's rate-limiting section, which rejects in-memory
 * counters for that reason). This does not cover the password step; that
 * one has its own, separately configured DB-backed cooldown — see
 * lib/security/password-cooldown.ts.
 */

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export async function isLockedOut(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { mfaLockedUntil: true } });
  return Boolean(user?.mfaLockedUntil && user.mfaLockedUntil > new Date());
}

export async function recordFailedMfaAttempt(userId: string): Promise<void> {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { mfaFailedAttempts: { increment: 1 } },
    select: { mfaFailedAttempts: true },
  });
  if (updated.mfaFailedAttempts >= MAX_ATTEMPTS) {
    await prisma.user.update({
      where: { id: userId },
      data: { mfaLockedUntil: new Date(Date.now() + LOCKOUT_MS), mfaFailedAttempts: 0 },
    });
  }
}

export async function resetMfaAttempts(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { mfaFailedAttempts: 0, mfaLockedUntil: null } });
}
