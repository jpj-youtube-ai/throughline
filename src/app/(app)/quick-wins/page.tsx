import { PageHeader } from "@/components/ui";
import { QuickWinsPanel } from "./quick-wins-panel";

export const dynamic = "force-dynamic";

export default function QuickWinsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Pick up next"
        title="Quick wins"
        lede="Unclaimed tasks ranked by how good a pickup they are — high confidence, low effort, low risk."
      />
      <QuickWinsPanel />
    </>
  );
}
