import { PageHeader } from "@/components/ui";
import { DriftPanel } from "./drift-panel";

export const dynamic = "force-dynamic";

export default function DriftPage() {
  return (
    <>
      <PageHeader
        eyebrow="Integrity"
        title="Drift"
        lede="Work in a PR that maps to no requirement. Flagged, never auto-resolved — you choose where it lands, with a reason."
      />
      <DriftPanel />
    </>
  );
}
