"use client";

import * as React from "react";
import { format, isPast, isToday } from "date-fns";
import type { TaskPriority, TaskStatus } from "@prisma/client";

import { cn } from "@/lib/utils";
import { taskPriorityLabel } from "@/lib/matters/format";
import { updateTaskStatus } from "@/lib/matters/actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { BadgeProps } from "@/components/ui/badge";

export type BoardTask = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  assignedTo: { name: string } | null;
};

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "OPEN", label: "Open" },
  { status: "IN_PROGRESS", label: "In Progress" },
  { status: "DONE", label: "Done" },
  { status: "CANCELLED", label: "Cancelled" },
];

const PRIORITY_VARIANT: Record<TaskPriority, BadgeProps["variant"]> = {
  LOW: "secondary",
  NORMAL: "outline",
  HIGH: "destructive",
};

/**
 * Kanban-style task board — the "replace monday.com" visual. Dropping a
 * card updates local state immediately (optimistic) and persists via the
 * `updateTaskStatus` Server Action; a failed write reverts the card to its
 * previous column so the board never shows a move that didn't actually
 * save.
 */
export function TaskBoard({ tasks: initialTasks, matterId }: { tasks: BoardTask[]; matterId: string }) {
  const [tasks, setTasks] = React.useState(initialTasks);
  const [prevInitialTasks, setPrevInitialTasks] = React.useState(initialTasks);
  const [dragOverColumn, setDragOverColumn] = React.useState<TaskStatus | null>(null);

  // Re-sync from fresh server data (e.g. after a revalidated refetch)
  // without an effect — see https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes.
  if (initialTasks !== prevInitialTasks) {
    setPrevInitialTasks(initialTasks);
    setTasks(initialTasks);
  }

  function moveTask(taskId: string, status: TaskStatus) {
    const previous = tasks;
    const task = previous.find((t) => t.id === taskId);
    if (!task || task.status === status) return;

    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status } : t)));

    updateTaskStatus({ matterId, taskId, status }).then((result) => {
      if (!result.ok) {
        setTasks(previous);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-4 overflow-x-auto sm:grid-cols-2 lg:grid-cols-4">
        {COLUMNS.map((column) => {
          const columnTasks = tasks.filter((t) => t.status === column.status);
          return (
            <div
              key={column.status}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverColumn(column.status);
              }}
              onDragLeave={() => setDragOverColumn((prev) => (prev === column.status ? null : prev))}
              onDrop={(e) => {
                e.preventDefault();
                const taskId = e.dataTransfer.getData("text/plain");
                if (taskId) moveTask(taskId, column.status);
                setDragOverColumn(null);
              }}
              className={cn(
                "flex min-h-[120px] flex-col gap-2 rounded-lg border border-border bg-muted/30 p-2 transition-colors",
                dragOverColumn === column.status && "border-primary bg-primary/5",
              )}
            >
              <div className="flex items-center justify-between px-1 pt-1">
                <h3 className="text-sm font-semibold text-foreground">{column.label}</h3>
                <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">
                  {columnTasks.length}
                </span>
              </div>

              <div className="flex flex-1 flex-col gap-2">
                {columnTasks.map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Drag a card between columns to change its status — moves save automatically.
      </p>
    </div>
  );
}

function TaskCard({ task }: { task: BoardTask }) {
  const overdue =
    task.dueDate &&
    task.status !== "DONE" &&
    task.status !== "CANCELLED" &&
    isPast(task.dueDate) &&
    !isToday(task.dueDate);

  return (
    <Card
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="cursor-grab border-l-4 bg-card shadow-sm active:cursor-grabbing"
      style={{
        borderLeftColor:
          task.priority === "HIGH"
            ? "hsl(var(--destructive))"
            : task.priority === "NORMAL"
              ? "hsl(var(--primary))"
              : "hsl(var(--muted-foreground))",
      }}
    >
      <CardContent className="space-y-2 p-3">
        <p className="text-sm font-medium leading-snug text-foreground">{task.title}</p>
        {task.description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <Badge variant={PRIORITY_VARIANT[task.priority]} className="text-[10px]">
            {taskPriorityLabel(task.priority)}
          </Badge>
          {task.dueDate && (
            <span className={cn("text-xs", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
              {overdue ? "Overdue " : ""}
              {format(task.dueDate, "MMM d")}
            </span>
          )}
        </div>
        {task.assignedTo && (
          <p className="text-xs text-muted-foreground">{task.assignedTo.name}</p>
        )}
      </CardContent>
    </Card>
  );
}
