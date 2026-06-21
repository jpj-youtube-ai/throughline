import { DrawerShell } from "@/components/drawer-shell";
import { NarrativePanel } from "../../narrative/narrative-panel";

export const dynamic = "force-dynamic";

export default function NarrativeDrawer() {
  return (
    <DrawerShell title="Narrative">
      <NarrativePanel />
    </DrawerShell>
  );
}
