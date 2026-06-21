import { PageHeader } from "@/components/ui";
import { PulsePanel } from "./pulse-panel";

export const dynamic = "force-dynamic";

export default function PulsePage() {
  return (
    <>
      <PageHeader
        eyebrow="The throughline"
        title="Pulse"
        lede="Every decision, in the order it happened — and the why beneath it."
      />
      <PulsePanel />
    </>
  );
}
