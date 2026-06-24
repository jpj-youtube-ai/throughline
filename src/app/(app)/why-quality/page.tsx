import { PageHeader } from "@/components/ui";
import { WhyQualityPanel } from "./why-quality-panel";

export const dynamic = "force-dynamic";

export default function WhyQualityPage() {
  return (
    <>
      <PageHeader
        eyebrow="Integrity"
        title="Why-quality"
        lede="The why is the point of the log. This grades the reasoning behind each decision — clarity, specificity, a real cause — and surfaces the thin ones."
      />
      <WhyQualityPanel />
    </>
  );
}
