import { DrawerShell } from "@/components/drawer-shell";
import { BurnUpPanel } from "../../burnup/burnup-panel";

export const dynamic = "force-dynamic";

export default function BurnUpDrawer() {
  return (
    <DrawerShell title="Burn-up">
      <BurnUpPanel />
    </DrawerShell>
  );
}
