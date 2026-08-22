import { prisma } from "@/lib/db";

/**
 * DB-backed (not in-memory) temporary cooldown for the password step,
 * computed from existing `FailedLoginAttempt` rows rather than a new
 * schema field — durable across restarts and correct across multiple app
 * instances, since every instance reads the same Postgres rows (see
 * docs/SECURITY.md's "Rate limiting status" for why an in-memory per-
 * process counter was rejected for this same step).
 *
 * This slows a single caller hammering one account's password field. It
 * is NOT a substitute for the WAF/reverse-proxy-level or Redis-backed
 * protection docs/SECURITY.md still calls for before real deployment, and
 * these thresholds are local/demo values, not an industry-standard or
 * production-approved configuration — revisit before any real account
 * relies on this.
 */

/** Failed attempts (for one account) inside the window below that trigger a cooldown. */
export const PASSWORD_COOLDOWN_ATTEMPT_THRESHOLD = 5;
/** Look-back window used to count recent failed attempts. */
export const PASSWORD_COOLDOWN_WINDOW_MS = 5 * 60 * 1000;
/** How long the password step stays blocked after the most recent attempt once the threshold is crossed. */
export const PASSWORD_COOLDOWN_DURATION_MS = 60 * 1000;

/**
 * Whether `accountId`'s password step is currently cooling down. Becomes
 * true once the account has accumulated
 * `PASSWORD_COOLDOWN_ATTEMPT_THRESHOLD` failed attempts inside
 * `PASSWORD_COOLDOWN_WINDOW_MS`, and stays true until
 * `PASSWORD_COOLDOWN_DURATION_MS` has passed since the most recent of
 * those attempts. Any attempt made while cooling down is itself recorded
 * as another failed attempt by the login path
 * (`lib/security/detection.ts#recordFailedLoginAttempt`), which pushes the
 * "most recent" attempt forward and so extends the cooldown — the same
 * "continued hammering stays locked out" behavior a real rate limiter
 * gives, without adding a second, parallel tracking mechanism.
 *
 * Never reveals *why* a password check failed to the caller — `verifyPassword`
 * returns `null` for a cooldown exactly as it does for a wrong password, so
 * this can't be used to distinguish "wrong password" from "rate limited"
 * from the outside.
 */
export async function isPasswordCooldownActive(accountId: string): Promise<boolean> {
  const windowStart = new Date(Date.now() - PASSWORD_COOLDOWN_WINDOW_MS);
  const recentAttempts = await prisma.failedLoginAttempt.findMany({
    where: { accountId, occurredAt: { gte: windowStart } },
    orderBy: { occurredAt: "desc" },
    take: PASSWORD_COOLDOWN_ATTEMPT_THRESHOLD,
    select: { occurredAt: true },
  });

  if (recentAttempts.length < PASSWORD_COOLDOWN_ATTEMPT_THRESHOLD) return false;

  const mostRecent = recentAttempts[0]?.occurredAt;
  if (!mostRecent) return false;

  return Date.now() - mostRecent.getTime() < PASSWORD_COOLDOWN_DURATION_MS;
}
