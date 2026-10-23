import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMinutes } from "@/lib/time/math";
import type { getMyTimeSummary } from "@/lib/time/queries";

/**
 * Dashboard card: the user's own recorded time today / this week, running
 * timer, and drafts awaiting confirmation. Server component — pass it the
 * result of `getMyTimeSummary(user)` (lib/time/queries.ts).
 */
export function TimeShortcutsCard({ summary }: { summary: Awaited<ReturnType<typeof getMyTimeSummary>> }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>My time</CardTitle>
        <Button size="sm" variant="outline" asChild>
          <Link href="/time">Record time</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        <p>
          <span className="text-muted-foreground">Today: </span>
          {formatMinutes(summary.todayMinutes)}
          <span className="text-muted-foreground"> · This week: </span>
          {formatMinutes(summary.weekMinutes)}
        </p>
        {summary.timer ? (
          <p>
            <span className="text-muted-foreground">Timer {summary.timer.running ? "running" : "paused"} on </span>
            <Link href={`/matters/${summary.timer.matterId}/time`} className="hover:underline">
              {summary.timer.matterLabel}
            </Link>
            {summary.timer.longRunning && <span className="text-amber-700"> — over 12 hours, please review</span>}
          </p>
        ) : (
          <p className="text-muted-foreground">No timer running.</p>
        )}
        {summary.draftCount > 0 && (
          <p className="text-amber-700">
            {summary.draftCount} draft {summary.draftCount === 1 ? "entry needs" : "entries need"} confirmation.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
