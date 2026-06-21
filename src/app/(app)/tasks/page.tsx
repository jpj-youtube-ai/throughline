import { PageHeader } from "@/components/ui";
import { TasksPanel } from "./tasks-panel";

export const dynamic = "force-dynamic";

export default function TasksPage() {
  return (
    <>
      <PageHeader
        eyebrow="Work"
        title="Tasks"
        lede="Generated from approved ideas — each task implements exactly one requirement."
      />
      <TasksPanel />
    </>
  );
}
