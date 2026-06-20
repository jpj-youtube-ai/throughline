import { listTasks } from "@/db/queries";
import { TaskRow } from "@/components/TaskRow";

// The task board (REQ-010). Lists tasks with their REQ link, claim state,
// and mirrored GitHub status.
export default async function TasksPage() {
  const tasks = await listTasks();
  return (
    <main className="task-board">
      <h1>Tasks</h1>
      <ul className="task-list">
        {tasks.map((t) => (
          <TaskRow key={t.key} task={t} />
        ))}
      </ul>
    </main>
  );
}
