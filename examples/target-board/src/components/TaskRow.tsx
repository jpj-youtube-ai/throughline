import type { TaskListItem } from "@/db/queries";

// Renders one task row on the board. Today it shows the title, the requirement
// link, claim state, and mirrored GitHub status — but NOT the effort / risk /
// confidence metrics, even though they are already present on `task`.
export function TaskRow({ task }: { task: TaskListItem }) {
  return (
    <li className="task-row">
      <a className="task-title" href={`/tasks/${task.key}`}>
        {task.key} — {task.title}
      </a>
      <a className="task-req" href={`/spec#${task.requirementKey}`}>
        {task.requirementKey}
      </a>
      <span className={`claim claim--${task.claimState}`}>{task.claimState}</span>
      <span className={`gh gh--${task.githubStatus}`}>{task.githubStatus}</span>
    </li>
  );
}
