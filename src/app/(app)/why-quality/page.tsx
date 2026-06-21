import { PageHeader } from "@/components/ui";
import { WhyQualityPanel } from "./why-quality-panel";

export const dynamic = "force-dynamic";

export default async function WhyQualityPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  const { run } = await searchParams;
  return (
    <>
      <PageHeader
        eyebrow="Integrity"
        title="Why-quality"
        lede={
          run === "1"
            ? "The reasoning behind each decision, graded — weakest first."
            : "The why is the point of the log. This grades the reasoning behind each decision — clarity, specificity, a real cause — and surfaces the thin ones."
        }
      />
      <WhyQualityPanel run={run} />
    </>
  );
}
