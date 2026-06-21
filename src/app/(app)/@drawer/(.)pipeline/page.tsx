import { DrawerShell } from "@/components/drawer-shell";
import { PipelinePanel } from "../../pipeline/pipeline-panel";

export const dynamic = "force-dynamic";

export default function PipelineDrawer() {
  return (
    <DrawerShell title="Pipeline">
      <PipelinePanel />
    </DrawerShell>
  );
}
