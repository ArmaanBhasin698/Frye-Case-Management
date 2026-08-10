"use client";

import * as React from "react";
import { useActionState } from "react";
import { format, isPast, isToday } from "date-fns";
import type { TaskPriority, TaskStatus } from "@prisma/client";

import { cn } from "@/lib/utils";
import { taskPriorityLabel } from "@/lib/matters/format";
import { updateTask, updateTaskStatus, type FormActionState } from "@/lib/matters/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { BadgeProps } from "@/components/ui/badge";

export type BoardTask = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  assignedTo: { id: string; name: string } | null;
};

export type AssignableUser = { id: string; name: string };

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

const INITIAL_STATE: FormActionState = { error: null };

/**
 * Kanban-style task board — the "replace monday.com" visual. Dropping a
 * card updates local state immediately (optimistic) and persists via the
 * `updateTaskStatus` Server Action; a failed write reverts the card to its
 * previous column so the board never shows a move that didn't actually
 * save. Editing a card's other fields (or its status, from the form) goes
 * through `updateTask` instead — both actions write the same `Task.status`
 * column, so a drag and a form edit can never disagree with each other.
 */
export function TaskBoard({
  tasks: initialTasks,
  matterId,
  assignableUsers,
}: {
  tasks: BoardTask[];
  matterId: string;
  assignableUsers: AssignableUser[];
}) {
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
                  <TaskCard key={task.id} task={task} matterId={matterId} assignableUsers={assignableUsers} />
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

function TaskEditForm({
  matterId,
  task,
  assignableUsers,
  onDone,
}: {
  matterId: string;
  task: BoardTask;
  assignableUsers: AssignableUser[];
  onDone: () => void;
}) {
  const [state, formAction, isPending] = useActionState(updateTask, INITIAL_STATE);

  // Call onDone from an effect, not during render — the state transition
  // means the update already committed, and this component's parent owns
  // `editing`, so we can't update it synchronously while this component
  // is still rendering.
  React.useEffect(() => {
    if (state !== INITIAL_STATE && !state.error) {
      onDone();
    }
  }, [state, onDone]);

  return (
    <form
      action={formAction}
      className="space-y-2"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input type="hidden" name="matterId" value={matterId} />
      <input type="hidden" name="taskId" value={task.id} />

      <div className="space-y-1">
        <Label htmlFor={`task-title-${task.id}`} className="text-xs">
          Title
        </Label>
        <Input id={`task-title-${task.id}`} name="title" required defaultValue={task.title} />
      </div>

      <div className="space-y-1">
        <Label htmlFor={`task-description-${task.id}`} className="text-xs">
          Description
        </Label>
        <Textarea
          id={`task-description-${task.id}`}
          name="description"
          rows={2}
          defaultValue={task.description ?? ""}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor={`task-dueDate-${task.id}`} className="text-xs">
            Due date
          </Label>
          <Input
            id={`task-dueDate-${task.id}`}
            name="dueDate"
            type="date"
            defaultValue={task.dueDate ? format(task.dueDate, "yyyy-MM-dd") : ""}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`task-priority-${task.id}`} className="text-xs">
            Priority
          </Label>
          <Select id={`task-priority-${task.id}`} name="priority" defaultValue={task.priority}>
            <option value="LOW">Low</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High</option>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`task-status-${task.id}`} className="text-xs">
            Status
          </Label>
          <Select id={`task-status-${task.id}`} name="status" defaultValue={task.status}>
            {COLUMNS.map((c) => (
              <option key={c.status} value={c.status}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`task-assignedToId-${task.id}`} className="text-xs">
            Assignee
          </Label>
          <Select
            id={`task-assignedToId-${task.id}`}
            name="assignedToId"
            defaultValue={task.assignedTo?.id ?? ""}
          >
            <option value="">Unassigned</option>
            {assignableUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {state.error && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function TaskCard({
  task,
  matterId,
  assignableUsers,
}: {
  task: BoardTask;
  matterId: string;
  assignableUsers: AssignableUser[];
}) {
  const [editing, setEditing] = React.useState(false);

  const overdue =
    task.dueDate &&
    task.status !== "DONE" &&
    task.status !== "CANCELLED" &&
    isPast(task.dueDate) &&
    !isToday(task.dueDate);

  if (editing) {
    return (
      <Card className="bg-card shadow-sm">
        <CardContent className="p-3">
          <TaskEditForm
            matterId={matterId}
            task={task}
            assignableUsers={assignableUsers}
            onDone={() => setEditing(false)}
          />
        </CardContent>
      </Card>
    );
  }

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
        <div className="flex items-start justify-between gap-1.5">
          <p className="text-sm font-medium leading-snug text-foreground">{task.title}</p>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-1.5 text-xs"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
        </div>
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
