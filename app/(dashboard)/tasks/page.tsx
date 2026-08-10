import Link from "next/link";
import { format, isPast, isToday } from "date-fns";
import type { TaskPriority, TaskStatus } from "@prisma/client";

import { getFirmWideTasks, type FirmTaskFilters, type FirmTaskSort } from "@/lib/tasks/queries";
import { listAssignableUsers, listMatters } from "@/lib/matters/queries";
import {
  asCalendarDate,
  formatClientName,
  matterTitle,
  taskPriorityLabel,
  taskStatusLabel,
  taskStatusVariant,
} from "@/lib/matters/format";
import { requireCurrentUser } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TaskFilterBar, type TaskFilterValues } from "@/components/shared/task-filter-bar";

const STATUS_VALUES = new Set<TaskStatus>(["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"]);
const PRIORITY_VALUES = new Set<TaskPriority>(["LOW", "NORMAL", "HIGH"]);

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Firm-wide Tasks (app/(dashboard)/tasks) — an authorized aggregate view
 * over the existing per-matter `Task` model, not a second Task record or
 * CRUD path. `getFirmWideTasks` (lib/tasks/queries.ts) scopes the query
 * server-side to matters `user` may see; every filter below is read from
 * the URL, validated against a fixed allowlist before it ever reaches
 * Prisma, and passed straight through to that helper rather than
 * filtered client-side.
 */
export default async function FirmTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCurrentUser();
  const params = await searchParams;

  const statusParam = readParam(params.status);
  const priorityParam = readParam(params.priority);
  const assignedToId = readParam(params.assignedToId) || "";
  const matterId = readParam(params.matterId) || "";
  const overdue = readParam(params.overdue) === "1";
  const sortParam = readParam(params.sort);

  const status =
    statusParam && STATUS_VALUES.has(statusParam as TaskStatus) ? (statusParam as TaskStatus) : undefined;
  const priority =
    priorityParam && PRIORITY_VALUES.has(priorityParam as TaskPriority)
      ? (priorityParam as TaskPriority)
      : undefined;
  const sort: FirmTaskSort = sortParam === "priority" ? "priority" : "dueDate";

  const filters: FirmTaskFilters = {
    status,
    priority,
    assignedToId: assignedToId || undefined,
    matterId: matterId || undefined,
    overdueOnly: overdue,
  };

  const [tasks, matters, assignableUsers] = await Promise.all([
    getFirmWideTasks(user, filters, sort),
    listMatters(user),
    listAssignableUsers(),
  ]);

  const currentFilters: TaskFilterValues = {
    status: status ?? "",
    priority: priority ?? "",
    assignedToId,
    matterId,
    overdue: overdue ? "1" : "",
    sort,
  };

  const matterOptions = matters.map((m) => ({ id: m.id, label: `${matterTitle(m)} · ${m.caseNumber}` }));
  const assigneeOptions = assignableUsers.map((u) => ({ id: u.id, label: u.name }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Tasks</h1>
        <p className="text-sm text-muted-foreground">
          Firm-wide tasks across every matter you have access to — an aggregate view over each matter&apos;s
          own Tasks tab, not a separate record. {tasks.length} {tasks.length === 1 ? "task" : "tasks"} match
          these filters.
        </p>
      </div>

      <TaskFilterBar
        basePath="/tasks"
        current={currentFilters}
        matters={matterOptions}
        assignableUsers={assigneeOptions}
      />

      <Card>
        <CardContent className="p-0">
          {tasks.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No tasks match these filters.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Matter</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Assignee</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => {
                  const overdueRow =
                    task.dueDate &&
                    task.status !== "DONE" &&
                    task.status !== "CANCELLED" &&
                    isPast(asCalendarDate(task.dueDate)) &&
                    !isToday(asCalendarDate(task.dueDate));
                  return (
                    <TableRow key={task.id}>
                      <TableCell>
                        <Link
                          href={`/matters/${task.matterId}/tasks`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {task.title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/matters/${task.matterId}`}
                          className="text-sm text-muted-foreground hover:underline"
                        >
                          {matterTitle(task.matter)}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {formatClientName(task.matter.client)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={taskStatusVariant(task.status)}>{taskStatusLabel(task.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {taskPriorityLabel(task.priority)}
                      </TableCell>
                      <TableCell
                        className={
                          overdueRow
                            ? "text-sm font-medium text-destructive"
                            : "text-sm text-muted-foreground"
                        }
                      >
                        {task.dueDate ? format(asCalendarDate(task.dueDate), "MMM d, yyyy") : "No due date"}
                        {overdueRow ? " · Overdue" : ""}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {task.assignedTo?.name ?? "Unassigned"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
