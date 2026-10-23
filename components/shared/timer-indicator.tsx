"use client";

import * as React from "react";
import Link from "next/link";
import { Timer } from "lucide-react";

import { getMyTimerState } from "@/lib/time/actions";
import { formatElapsed, useTicking, type TimerSnapshot } from "@/components/shared/timer-controls";

const POLL_MS = 30_000;

/**
 * Compact "timer running" indicator for the app header. No props: it
 * fetches the signed-in user's own timer via `getMyTimerState` (a Server
 * Action that only ever returns the caller's timer) every 30 seconds and on
 * window focus, and ticks locally in between. Renders nothing when no timer
 * exists. Links to /time.
 */
export function TimerIndicator() {
  const [timer, setTimer] = React.useState<TimerSnapshot | null>(null);
  const elapsed = useTicking(timer);

  React.useEffect(() => {
    let cancelled = false;
    const load = () =>
      getMyTimerState()
        .then((t) => {
          if (!cancelled) setTimer(t);
        })
        .catch(() => {});
    load();
    const id = window.setInterval(load, POLL_MS);
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", load);
    };
  }, []);

  if (!timer) return null;
  return (
    <Link
      href="/time"
      className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-xs font-medium text-foreground hover:bg-primary/10"
      title={`Timer ${timer.running ? "running" : "paused"} on ${timer.matterLabel}`}
    >
      <Timer className="h-3.5 w-3.5 text-primary" />
      <span className="font-mono tabular-nums">{formatElapsed(elapsed)}</span>
      <span className="hidden text-muted-foreground sm:inline">{timer.matterLabel}</span>
      {!timer.running && <span className="text-muted-foreground">(paused)</span>}
    </Link>
  );
}
