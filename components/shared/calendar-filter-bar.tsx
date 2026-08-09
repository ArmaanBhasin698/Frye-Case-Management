"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { FilterOption } from "@/components/shared/task-filter-bar";

export type CalendarFilterValues = {
  matterId: string;
  kind: string;
  deadlineStatus: string;
  includePast: string;
};

/**
 * Filter bar for the firm-wide Calendar page (app/(dashboard)/calendar).
 * `matters` is already scoped server-side before reaching this
 * component — this component only builds a query string and navigates.
 */
export function CalendarFilterBar({
  basePath,
  current,
  matters,
}: {
  basePath: string;
  current: CalendarFilterValues;
  matters: FilterOption[];
}) {
  const router = useRouter();

  function update(next: Partial<CalendarFilterValues>) {
    const merged = { ...current, ...next };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    const query = params.toString();
    router.push(query ? `${basePath}?${query}` : basePath);
  }

  const hasFilters = Object.values(current).some(Boolean);

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="space-y-1">
        <Label htmlFor="calendar-filter-type" className="text-xs">
          Type
        </Label>
        <Select
          id="calendar-filter-type"
          className="w-40"
          value={current.kind}
          onChange={(e) => update({ kind: e.target.value })}
        >
          <option value="">Deadlines &amp; Events</option>
          <option value="deadline">Deadlines only</option>
          <option value="event">Calendar Events only</option>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="calendar-filter-deadline-status" className="text-xs">
          Deadline status
        </Label>
        <Select
          id="calendar-filter-deadline-status"
          className="w-40"
          value={current.deadlineStatus}
          onChange={(e) => update({ deadlineStatus: e.target.value })}
        >
          <option value="">Any</option>
          <option value="open">Open only</option>
          <option value="satisfied">Satisfied only</option>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="calendar-filter-matter" className="text-xs">
          Matter
        </Label>
        <Select
          id="calendar-filter-matter"
          className="w-48"
          value={current.matterId}
          onChange={(e) => update({ matterId: e.target.value })}
        >
          <option value="">All matters</option>
          {matters.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="calendar-filter-range" className="text-xs">
          Range
        </Label>
        <Select
          id="calendar-filter-range"
          className="w-40"
          value={current.includePast}
          onChange={(e) => update({ includePast: e.target.value })}
        >
          <option value="">Upcoming only</option>
          <option value="1">Include past</option>
        </Select>
      </div>

      <Button
        variant="ghost"
        size="sm"
        disabled={!hasFilters}
        onClick={() => router.push(basePath)}
      >
        Clear filters
      </Button>
    </div>
  );
}
