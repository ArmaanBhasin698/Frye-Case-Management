import { format } from "date-fns";

import { getMatterTasks } from "@/lib/matters/queries";
import { taskPriorityLabel, taskStatusLabel, taskStatusVariant } from "@/lib/matters/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function MatterTasksPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const tasks = await getMatterTasks(matterId);

  return (
    <Card>
      <CardContent className="p-0">
        {tasks.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No tasks on this matter yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Assigned to</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell>
                    <div className="font-medium text-foreground">{task.title}</div>
                    {task.description && (
                      <div className="text-xs text-muted-foreground">{task.description}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {task.assignedTo?.name ?? "Unassigned"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {taskPriorityLabel(task.priority)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={taskStatusVariant(task.status)}>
                      {taskStatusLabel(task.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {task.dueDate ? format(task.dueDate, "MMM d, yyyy") : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
