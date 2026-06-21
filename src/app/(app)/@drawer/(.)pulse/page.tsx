import { DrawerShell } from "@/components/drawer-shell";
import { PulsePanel } from "../../pulse/pulse-panel";

export const dynamic = "force-dynamic";

export default function PulseDrawer() {
  return (
    <DrawerShell title="Pulse">
      <PulsePanel />
    </DrawerShell>
  );
}
