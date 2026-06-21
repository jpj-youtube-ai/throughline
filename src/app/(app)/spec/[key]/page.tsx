import { PageHeader } from "@/components/ui";
import { RequirementDetail } from "../requirement-detail";

export const dynamic = "force-dynamic";

export default async function RequirementPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return (
    <>
      <PageHeader eyebrow="Specification" title={key} lede="Requirement detail." />
      <RequirementDetail reqKey={key} />
    </>
  );
}
