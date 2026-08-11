"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export type FilterOption = { id: string; label: string };

export type TaskFilterValues = {
  status: string;
  priority: string;
  assignedToId: string;
  matterId: string;
  overdue: string;
  sort: string;
};

/**
 * Filter bar for the firm-wide Tasks page (app/(dashboard)/tasks). Every
 * option list (`matters`, `assignableUsers`) is server-scoped before it
 * ever reaches this component — this component only builds a query
 * string and navigates; it never fetches or filters data itself.
 */
export function TaskFilterBar({
  basePath,
  current,
  matters,
  assignableUsers,
}: {
  basePath: string;
  current: TaskFilterValues;
  matters: FilterOption[];
  assignableUsers: FilterOption[];
}) {
  const router = useRouter();

  function update(next: Partial<TaskFilterValues>) {
    const merged = { ...current, ...next };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    const query = params.toString();
    router.push(query ? `${basePath}?${query}` : basePath);
  }

  // `sort` always has a default value (see app/(dashboard)/tasks/page.tsx)
  // even with no real filter applied, so it's excluded here — otherwise
  // "Clear filters" would render enabled on every load, filtered or not.
  const hasFilters = Object.entries(current).some(([key, value]) => key !== "sort" && Boolean(value));

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="space-y-1">
        <Label htmlFor="task-filter-status" className="text-xs">
          Status
        </Label>
        <Select
          id="task-filter-status"
          className="w-40"
          value={current.status}
          onChange={(e) => update({ status: e.target.value })}
        >
          <option value="">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="DONE">Done</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="task-filter-priority" className="text-xs">
          Priority
        </Label>
        <Select
          id="task-filter-priority"
          className="w-36"
          value={current.priority}
          onChange={(e) => update({ priority: e.target.value })}
        >
          <option value="">All priorities</option>
          <option value="HIGH">High</option>
          <option value="NORMAL">Normal</option>
          <option value="LOW">Low</option>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="task-filter-assignee" className="text-xs">
          Assignee
        </Label>
        <Select
          id="task-filter-assignee"
          className="w-44"
          value={current.assignedToId}
          onChange={(e) => update({ assignedToId: e.target.value })}
        >
          <option value="">Everyone</option>
          {assignableUsers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="task-filter-matter" className="text-xs">
          Matter
        </Label>
        <Select
          id="task-filter-matter"
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
        <Label htmlFor="task-filter-overdue" className="text-xs">
          Due
        </Label>
        <Select
          id="task-filter-overdue"
          className="w-36"
          value={current.overdue}
          onChange={(e) => update({ overdue: e.target.value })}
        >
          <option value="">All tasks</option>
          <option value="1">Overdue only</option>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="task-filter-sort" className="text-xs">
          Sort by
        </Label>
        <Select
          id="task-filter-sort"
          className="w-36"
          value={current.sort}
          onChange={(e) => update({ sort: e.target.value })}
        >
          <option value="dueDate">Due date</option>
          <option value="priority">Priority</option>
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
