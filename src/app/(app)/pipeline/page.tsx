import { PageHeader } from "@/components/ui";
import { PipelinePanel } from "./pipeline-panel";

export const dynamic = "force-dynamic";

export default function PipelinePage() {
  return (
    <>
      <PageHeader
        eyebrow="Lifecycle"
        title="Pipeline"
        lede="Where everything is right now, as an idea becomes merged work. Read-only — each item moves by a logged decision."
      />
      <PipelinePanel />
    </>
  );
}
