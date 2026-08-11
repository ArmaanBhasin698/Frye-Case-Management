"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { FilterOption } from "@/components/shared/task-filter-bar";

export type CommunicationsFilterValues = {
  matterId: string;
  direction: string;
  filedState: string;
  sort: string;
};

/**
 * Filter bar for the firm-wide Communications page
 * (app/(dashboard)/communications). `matters` is already scoped
 * server-side to what the current user may see before reaching this
 * component — this component only builds a query string and navigates,
 * same convention as `TaskFilterBar`/`CalendarFilterBar`.
 */
export function CommunicationsFilterBar({
  basePath,
  current,
  matters,
  canFilterUnfiled,
}: {
  basePath: string;
  current: CommunicationsFilterValues;
  matters: FilterOption[];
  /** Whether the current user is even allowed to see unfiled calls — see lib/communications/queries.ts. */
  canFilterUnfiled: boolean;
}) {
  const router = useRouter();

  function update(next: Partial<CommunicationsFilterValues>) {
    const merged = { ...current, ...next };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    const query = params.toString();
    router.push(query ? `${basePath}?${query}` : basePath);
  }

  // `sort` always has a default value (see app/(dashboard)/communications/page.tsx)
  // even with no real filter applied, so it's excluded here — otherwise
  // "Clear filters" would render enabled on every load, filtered or not.
  const hasFilters = Object.entries(current).some(([key, value]) => key !== "sort" && Boolean(value));

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="space-y-1">
        <Label htmlFor="comms-filter-direction" className="text-xs">
          Direction
        </Label>
        <Select
          id="comms-filter-direction"
          className="w-36"
          value={current.direction}
          onChange={(e) => update({ direction: e.target.value })}
        >
          <option value="">Any direction</option>
          <option value="INBOUND">Inbound</option>
          <option value="OUTBOUND">Outbound</option>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="comms-filter-matter" className="text-xs">
          Matter
        </Label>
        <Select
          id="comms-filter-matter"
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

      {canFilterUnfiled && (
        <div className="space-y-1">
          <Label htmlFor="comms-filter-filed" className="text-xs">
            Filed state
          </Label>
          <Select
            id="comms-filter-filed"
            className="w-36"
            value={current.filedState}
            onChange={(e) => update({ filedState: e.target.value })}
          >
            <option value="">Filed &amp; unfiled</option>
            <option value="filed">Filed only</option>
            <option value="unfiled">Unfiled only</option>
          </Select>
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="comms-filter-sort" className="text-xs">
          Sort by
        </Label>
        <Select
          id="comms-filter-sort"
          className="w-36"
          value={current.sort}
          onChange={(e) => update({ sort: e.target.value })}
        >
          <option value="recent">Most recent</option>
          <option value="oldest">Oldest first</option>
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
