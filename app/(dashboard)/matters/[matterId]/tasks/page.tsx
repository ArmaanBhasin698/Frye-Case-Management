import { getMatterTasks } from "@/lib/matters/queries";
import { TaskBoard } from "@/components/shared/task-board";

export default async function MatterTasksPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const tasks = await getMatterTasks(matterId);

  if (tasks.length === 0) {
    return <p className="text-sm text-muted-foreground">No tasks on this matter yet.</p>;
  }

  return <TaskBoard tasks={tasks} />;
}
