import { DrawerShell } from "@/components/drawer-shell";
import { WhyQualityPanel } from "../../why-quality/why-quality-panel";

export const dynamic = "force-dynamic";

export default function WhyQualityDrawer() {
  return (
    <DrawerShell title="Why-quality">
      <WhyQualityPanel />
    </DrawerShell>
  );
}
