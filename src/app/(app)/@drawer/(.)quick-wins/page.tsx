import { DrawerShell } from "@/components/drawer-shell";
import { QuickWinsPanel } from "../../quick-wins/quick-wins-panel";

export const dynamic = "force-dynamic";

export default function QuickWinsDrawer() {
  return (
    <DrawerShell title="Quick wins">
      <QuickWinsPanel />
    </DrawerShell>
  );
}
