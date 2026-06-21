import { PageHeader } from "@/components/ui";
import { NarrativePanel } from "./narrative-panel";

export const dynamic = "force-dynamic";

export default function NarrativePage() {
  return (
    <>
      <PageHeader
        eyebrow="History"
        title="Narrative"
        lede="The story so far, told from the log — grounded in real decisions, never invented. Regenerated on demand."
      />
      <NarrativePanel />
    </>
  );
}
