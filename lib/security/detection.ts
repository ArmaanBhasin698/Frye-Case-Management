import { prisma } from "@/lib/db";

/**
 * Suspicious-login detection: records every failed password attempt
 * (lib/auth/login-flow.ts's caller, app/(auth)/login/actions.ts, is the
 * only place this is invoked from) and opens a SecurityIncident once the
 * same account accumulates SUSPICIOUS_LOGIN_THRESHOLD failures inside
 * SUSPICIOUS_LOGIN_WINDOW_MS. This is a configurable demonstration rule,
 * not an industry-standard threshold (see docs/SECURITY.md) — this is
 * detection/alerting for a human to triage, not the thing that actually
 * blocks a password attempt. The rows this writes are also read by
 * lib/security/password-cooldown.ts, which is what actually blocks
 * further password attempts once an account crosses its own threshold;
 * the two are independent (different thresholds, different purposes) but
 * share the same underlying FailedLoginAttempt data rather than tracking
 * failures twice.
 *
 * Deliberately never records or derives anything from the attempted
 * password itself.
 */

export const SUSPICIOUS_LOGIN_THRESHOLD = 5;
export const SUSPICIOUS_LOGIN_WINDOW_MS = 10 * 60 * 1000;

/**
 * Records one failed password attempt and, if it's the account's 5th (or
 * later) within the last 10 minutes, opens a SecurityIncident — unless one
 * is already OPEN or INVESTIGATING for this account, so a continuing
 * attack doesn't spam duplicate incidents. `email` is only ever used to
 * look up the matching account id; it is stored (lowercased/trimmed) as
 * `emailAttempted` for investigation context, never the password.
 */
export async function recordFailedLoginAttempt(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  const account = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });

  await prisma.failedLoginAttempt.create({
    data: { accountId: account?.id ?? null, emailAttempted: normalizedEmail },
  });

  if (account) {
    await detectSuspiciousLogin(account.id);
  }
}

async function detectSuspiciousLogin(accountId: string): Promise<void> {
  const windowStart = new Date(Date.now() - SUSPICIOUS_LOGIN_WINDOW_MS);
  const recentAttempts = await prisma.failedLoginAttempt.findMany({
    where: { accountId, occurredAt: { gte: windowStart } },
    orderBy: { occurredAt: "asc" },
    select: { occurredAt: true },
  });

  if (recentAttempts.length < SUSPICIOUS_LOGIN_THRESHOLD) return;

  const existingActiveIncident = await prisma.securityIncident.findFirst({
    where: {
      accountId,
      category: "SUSPICIOUS_LOGIN",
      status: { in: ["OPEN", "INVESTIGATING"] },
    },
  });
  if (existingActiveIncident) return;

  const first = recentAttempts[0];
  const last = recentAttempts[recentAttempts.length - 1];
  if (!first || !last) return;

  await prisma.securityIncident.create({
    data: {
      category: "SUSPICIOUS_LOGIN",
      severity: "MEDIUM",
      accountId,
      failedAttemptCount: recentAttempts.length,
      windowStart: first.occurredAt,
      windowEnd: last.occurredAt,
    },
  });
}
