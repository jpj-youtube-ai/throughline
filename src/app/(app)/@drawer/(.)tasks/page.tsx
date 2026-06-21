import { DrawerShell } from "@/components/drawer-shell";
import { TasksPanel } from "../../tasks/tasks-panel";

export const dynamic = "force-dynamic";

export default function TasksDrawer() {
  return (
    <DrawerShell title="Tasks">
      <TasksPanel />
    </DrawerShell>
  );
}
