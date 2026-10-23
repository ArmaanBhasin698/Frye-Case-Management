import { prisma } from "@/lib/db";

/**
 * Usage-analytics retention (docs/FIRM_OPERATIONS_EXPANSION.md, decision 5):
 * 365 days, purged only when an ADMIN explicitly confirms — never on a
 * schedule. `USAGE_RETENTION_HOLD=true` (a preservation / litigation hold)
 * blocks purging entirely. Only usage analytics are in scope: AuditEvent,
 * FailedLoginAttempt, SecurityIncident, and TimeEntry are never touched.
 */
export const USAGE_RETENTION_DAYS = 365;

/** Exact text an ADMIN must type to confirm a purge (lib/usage/actions.ts#purgeUsageData). */
export const PURGE_CONFIRMATION_PHRASE = "PURGE USAGE DATA";

export function retentionCutoff(now = new Date()): Date {
  return new Date(now.getTime() - USAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export function isRetentionHoldActive(env: Record<string, string | undefined> = process.env): boolean {
  return (env.USAGE_RETENTION_HOLD ?? "").trim().toLowerCase() === "true";
}

export async function countPurgeableUsage(now = new Date()) {
  const cutoff = retentionCutoff(now);
  const [events, minutes, sessions] = await Promise.all([
    prisma.userActivityEvent.count({ where: { occurredAt: { lt: cutoff } } }),
    prisma.userActivityMinute.count({ where: { minute: { lt: cutoff } } }),
    prisma.userSession.count({ where: { endedAt: { not: null, lt: cutoff } } }),
  ]);
  return { cutoff, events, minutes, sessions };
}

/** Deletes usage rows older than the cutoff, in one transaction. Open sessions are never purged. */
export async function purgeExpiredUsage(now = new Date()) {
  const cutoff = retentionCutoff(now);
  const [events, minutes, sessions] = await prisma.$transaction([
    prisma.userActivityEvent.deleteMany({ where: { occurredAt: { lt: cutoff } } }),
    prisma.userActivityMinute.deleteMany({ where: { minute: { lt: cutoff } } }),
    prisma.userSession.deleteMany({ where: { endedAt: { not: null, lt: cutoff } } }),
  ]);
  return { cutoff, events: events.count, minutes: minutes.count, sessions: sessions.count };
}
