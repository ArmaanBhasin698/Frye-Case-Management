import { getMatterTasks } from "@/lib/matters/queries";
import { TaskBoard } from "@/components/shared/task-board";
import { NewTaskForm } from "@/components/shared/new-task-form";

export default async function MatterTasksPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const tasks = await getMatterTasks(matterId);

  return (
    <div className="space-y-4">
      <NewTaskForm matterId={matterId} />
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tasks on this matter yet.</p>
      ) : (
        <TaskBoard tasks={tasks} matterId={matterId} />
      )}
    </div>
  );
}
