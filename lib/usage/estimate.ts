/**
 * Pure estimation over UserActivityMinute rows. Every value here is an
 * ESTIMATE: a minute counts as active only because a visible, recently
 * interacted-with tab sent a heartbeat during it. Rows are unique per
 * (user, minute), so several tabs or devices open at once collapse into
 * one minute — overlapping activity is never double-counted. These numbers
 * are never billable time (that's TimeEntry, recorded by people).
 */

export const IDLE_THRESHOLD_MINUTES = 5;
export const HEARTBEAT_INTERVAL_SECONDS = 60;
export const ESTIMATE_LABEL = "Estimated from activity heartbeats — not recorded work time";

export function floorToMinute(date: Date): Date {
  const d = new Date(date);
  d.setUTCSeconds(0, 0);
  return d;
}

/** Distinct active minutes — dedupes defensively even if the input repeats a minute. */
export function estimateActiveMinutes(minutes: Date[]): number {
  return new Set(minutes.map((m) => floorToMinute(m).getTime())).size;
}

export type IdleGap = { from: Date; to: Date; minutes: number };

/** Gaps between consecutive active minutes longer than the idle threshold. */
export function findIdleGaps(minutes: Date[], thresholdMinutes = IDLE_THRESHOLD_MINUTES): IdleGap[] {
  const sorted = [...new Set(minutes.map((m) => floorToMinute(m).getTime()))].sort((a, b) => a - b);
  const gaps: IdleGap[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gapMinutes = (sorted[i]! - sorted[i - 1]!) / 60_000 - 1;
    if (gapMinutes > thresholdMinutes) {
      gaps.push({ from: new Date(sorted[i - 1]! + 60_000), to: new Date(sorted[i]!), minutes: gapMinutes });
    }
  }
  return gaps;
}

/** Wall-clock minutes from session start to its end (or last seen activity while still open). */
export function sessionDurationMinutes(session: { startedAt: Date; lastSeenAt: Date; endedAt: Date | null }): number {
  const end = session.endedAt ?? session.lastSeenAt;
  return Math.max(0, Math.round((end.getTime() - session.startedAt.getTime()) / 60_000));
}

/** Session span minus active minutes, never negative. */
export function estimateIdleMinutes(durationMinutes: number, activeMinutes: number): number {
  return Math.max(0, durationMinutes - activeMinutes);
}

/** Active minutes per matter, from minutes whose heartbeat came from a matter page. */
export function matterFocusedMinutes(rows: { matterId: string | null }[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (!row.matterId) continue;
    totals.set(row.matterId, (totals.get(row.matterId) ?? 0) + 1);
  }
  return totals;
}

const EASTERN_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "YYYY-MM-DD" in the firm's time zone (America/New_York). */
export function easternDay(date: Date): string {
  return EASTERN_DAY.format(date);
}

/** Active minutes per Eastern calendar day. */
export function dailyActiveMinutes(rows: { minute: Date }[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const day = easternDay(row.minute);
    totals.set(day, (totals.get(day) ?? 0) + 1);
  }
  return totals;
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
