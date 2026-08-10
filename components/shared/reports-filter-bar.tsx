"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { FilterOption } from "@/components/shared/task-filter-bar";

export type ReportsFilterValues = {
  matterId: string;
  window: string;
};

/**
 * Filter bar for the firm-wide Reports page (app/(dashboard)/reports).
 * `matters` is already scoped server-side to what the current user may see
 * before reaching this component — same convention as
 * `TaskFilterBar`/`DiscoveryFilterBar`/`CommunicationsFilterBar`: this
 * component only builds a query string and navigates, it never fetches or
 * filters report data itself.
 */
export function ReportsFilterBar({
  basePath,
  current,
  matters,
}: {
  basePath: string;
  current: ReportsFilterValues;
  matters: FilterOption[];
}) {
  const router = useRouter();

  function update(next: Partial<ReportsFilterValues>) {
    const merged = { ...current, ...next };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value && value !== "30d") params.set(key, value);
    }
    const query = params.toString();
    router.push(query ? `${basePath}?${query}` : basePath);
  }

  const hasFilters = Boolean(current.matterId) || (current.window && current.window !== "30d");

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="space-y-1">
        <Label htmlFor="reports-filter-matter" className="text-xs">
          Matter
        </Label>
        <Select
          id="reports-filter-matter"
          className="w-56"
          value={current.matterId}
          onChange={(e) => update({ matterId: e.target.value })}
        >
          <option value="">All matters you can access</option>
          {matters.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="reports-filter-window" className="text-xs">
          Activity window
        </Label>
        <Select
          id="reports-filter-window"
          className="w-44"
          value={current.window}
          onChange={(e) => update({ window: e.target.value })}
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="all">All time</option>
        </Select>
      </div>

      <Button variant="ghost" size="sm" disabled={!hasFilters} onClick={() => router.push(basePath)}>
        Clear filters
      </Button>
    </div>
  );
}
