import { PageHeader } from "@/components/ui";
import { SpecDocument } from "../spec-document";

export const dynamic = "force-dynamic";

export default function SpecDocumentPage() {
  return (
    <>
      <PageHeader
        eyebrow="Specification"
        title="SPEC.md"
        lede="The materialized spec document — generated from the requirement log, never hand-edited."
      />
      <SpecDocument />
    </>
  );
}
