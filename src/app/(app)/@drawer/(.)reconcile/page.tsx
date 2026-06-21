import { DrawerShell } from "@/components/drawer-shell";
import { ReconcilePanel } from "../../reconcile/reconcile-panel";

export const dynamic = "force-dynamic";

export default function ReconcileDrawer() {
  return (
    <DrawerShell title="Reconciliation">
      <ReconcilePanel />
    </DrawerShell>
  );
}
