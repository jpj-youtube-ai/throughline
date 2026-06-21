import { PageHeader } from "@/components/ui";
import { DigestPanel } from "./digest-panel";

export const dynamic = "force-dynamic";

export default function DigestPage() {
  return (
    <>
      <PageHeader
        eyebrow="Surface"
        title="Digest"
        lede="An on-demand summary of what has moved since the last digest — generated on request and read here. No outbound delivery."
      />
      <DigestPanel />
    </>
  );
}
