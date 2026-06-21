import { DrawerShell } from "@/components/drawer-shell";
import { DigestPanel } from "../../digest/digest-panel";

export const dynamic = "force-dynamic";

export default function DigestDrawer() {
  return (
    <DrawerShell title="Digest">
      <DigestPanel />
    </DrawerShell>
  );
}
