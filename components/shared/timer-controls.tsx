"use client";

import * as React from "react";
import Link from "next/link";
import type { TimeActivityCategory } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { discardTimer, pauseTimer, resumeTimer, startTimer, stopTimer, type TimerResult } from "@/lib/time/actions";
import { TIME_CATEGORY_LABELS, TIME_CATEGORY_VALUES } from "@/lib/time/labels";

export type TimerSnapshot = {
  matterId: string;
  matterLabel: string;
  elapsedSeconds: number;
  running: boolean;
};

export function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Ticks a server-provided elapsed value locally while the timer runs. */
export function useTicking(snapshot: TimerSnapshot | null): number {
  const [elapsed, setElapsed] = React.useState(snapshot?.elapsedSeconds ?? 0);
  const [base, setBase] = React.useState(snapshot);
  if (snapshot !== base) {
    setBase(snapshot);
    setElapsed(snapshot?.elapsedSeconds ?? 0);
  }
  React.useEffect(() => {
    if (!snapshot?.running) return;
    const started = Date.now() - snapshot.elapsedSeconds * 1000;
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [snapshot]);
  return elapsed;
}

/**
 * Start/pause/resume/stop controls for the current user's single timer.
 * `matterId` is the matter this control lives on. Starting while a timer
 * runs on another matter asks before switching (the old timer becomes a
 * draft entry, never discarded). Stopping a timer that ran 12+ hours asks
 * the user to confirm or enter the time actually worked.
 */
export function TimerControls({ matterId, timer }: { matterId: string; timer: TimerSnapshot | null }) {
  const elapsed = useTicking(timer);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [category, setCategory] = React.useState<TimeActivityCategory>("LEGAL_RESEARCH");
  const [description, setDescription] = React.useState("");
  const [confirmMinutes, setConfirmMinutes] = React.useState<number | null>(null);

  async function run(fn: () => Promise<TimerResult>) {
    setError(null);
    setPending(true);
    const result = await fn();
    setPending(false);
    if (!result.ok) {
      if (result.code === "TIMER_RUNNING") {
        if (window.confirm("A timer is running on another matter. Stop it (saving a draft entry) and start this one?")) {
          return run(() => startTimer({ matterId, category, description, switchFromExisting: true }));
        }
        return;
      }
      if (result.code === "NEEDS_CONFIRMATION") {
        setConfirmMinutes(result.elapsedMinutes ?? null);
      }
      setError(result.error);
    } else {
      setConfirmMinutes(null);
    }
  }

  const here = timer && timer.matterId === matterId;

  if (here) {
    return (
      <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-lg tabular-nums">{formatElapsed(elapsed)}</span>
          <span className="text-sm text-muted-foreground">{timer.running ? "Timer running" : "Timer paused"}</span>
          <div className="ml-auto flex gap-2">
            {timer.running ? (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(pauseTimer)}>
                Pause
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(resumeTimer)}>
                Resume
              </Button>
            )}
            <Button size="sm" disabled={pending} onClick={() => run(() => stopTimer())}>
              Stop &amp; review
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => window.confirm("Discard this timer without recording any time?") && run(discardTimer)}
            >
              Discard
            </Button>
          </div>
        </div>
        {confirmMinutes !== null && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const minutes = Number(new FormData(e.currentTarget).get("adjusted"));
              run(() => stopTimer({ confirmLongRunning: true, adjustedMinutes: minutes > 0 ? minutes : undefined }));
            }}
          >
            <label className="text-sm">
              Minutes actually worked
              <Input name="adjusted" type="number" min={1} max={1440} defaultValue={Math.min(confirmMinutes, 1440)} className="w-32" />
            </label>
            <Button size="sm" type="submit" disabled={pending}>
              Confirm &amp; stop
            </Button>
          </form>
        )}
        <p className="text-xs text-muted-foreground">
          Stopping creates a draft entry you confirm on the{" "}
          <Link href="/time" className="underline">
            Time
          </Link>{" "}
          page.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      {timer && (
        <p className="text-xs text-muted-foreground">
          Your timer is running on {timer.matterLabel} ({formatElapsed(elapsed)}).
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Select
          aria-label="Activity"
          className="w-48"
          value={category}
          onChange={(e) => setCategory(e.target.value as TimeActivityCategory)}
        >
          {TIME_CATEGORY_VALUES.map((c) => (
            <option key={c} value={c}>
              {TIME_CATEGORY_LABELS[c]}
            </option>
          ))}
        </Select>
        <Input
          aria-label="What are you working on?"
          placeholder="What are you working on? (optional)"
          className="w-64"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Button size="sm" disabled={pending} onClick={() => run(() => startTimer({ matterId, category, description }))}>
          Start timer
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
