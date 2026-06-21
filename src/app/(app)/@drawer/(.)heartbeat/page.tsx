import { DrawerShell } from "@/components/drawer-shell";
import { HeartbeatPanel } from "../../heartbeat/heartbeat-panel";

export const dynamic = "force-dynamic";

export default function HeartbeatDrawer() {
  return (
    <DrawerShell title="Heartbeat">
      <HeartbeatPanel />
    </DrawerShell>
  );
}
