"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { FilterOption } from "@/components/shared/task-filter-bar";

export type DiscoveryFilterValues = {
  matterId: string;
  fileType: string;
  reviewStatus: string;
  sort: string;
};

/**
 * Filter bar for the firm-wide Discovery page (app/(dashboard)/discovery).
 * `matters` is already scoped server-side to what the current user may see
 * before reaching this component — this component only builds a query
 * string and navigates, same convention as `TaskFilterBar`/
 * `CommunicationsFilterBar`.
 */
export function DiscoveryFilterBar({
  basePath,
  current,
  matters,
}: {
  basePath: string;
  current: DiscoveryFilterValues;
  matters: FilterOption[];
}) {
  const router = useRouter();

  function update(next: Partial<DiscoveryFilterValues>) {
    const merged = { ...current, ...next };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    const query = params.toString();
    router.push(query ? `${basePath}?${query}` : basePath);
  }

  // `sort` always has a default value (see app/(dashboard)/discovery/page.tsx)
  // even with no real filter applied, so it's excluded here — otherwise
  // "Clear filters" would render enabled on every load, filtered or not.
  const hasFilters = Object.entries(current).some(([key, value]) => key !== "sort" && Boolean(value));

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="space-y-1">
        <Label htmlFor="discovery-filter-matter" className="text-xs">
          Matter
        </Label>
        <Select
          id="discovery-filter-matter"
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
        <Label htmlFor="discovery-filter-type" className="text-xs">
          File type
        </Label>
        <Select
          id="discovery-filter-type"
          className="w-36"
          value={current.fileType}
          onChange={(e) => update({ fileType: e.target.value })}
        >
          <option value="">Any type</option>
          <option value="PDF">PDF</option>
          <option value="VIDEO">Video</option>
          <option value="AUDIO">Audio</option>
          <option value="PHOTO">Photo</option>
          <option value="OTHER">Other</option>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="discovery-filter-status" className="text-xs">
          Review status
        </Label>
        <Select
          id="discovery-filter-status"
          className="w-40"
          value={current.reviewStatus}
          onChange={(e) => update({ reviewStatus: e.target.value })}
        >
          <option value="">Any status</option>
          <option value="NOT_STARTED">Not Started</option>
          <option value="IN_REVIEW">In Review</option>
          <option value="COMPLETE">Reviewed</option>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="discovery-filter-sort" className="text-xs">
          Sort by
        </Label>
        <Select
          id="discovery-filter-sort"
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
