import { DrawerShell } from "@/components/drawer-shell";
import { DriftPanel } from "../../drift/drift-panel";

export const dynamic = "force-dynamic";

export default function DriftDrawer() {
  return (
    <DrawerShell title="Drift">
      <DriftPanel />
    </DrawerShell>
  );
}
