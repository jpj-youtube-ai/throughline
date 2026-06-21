import { PageHeader } from "@/components/ui";
import { DigestPanel } from "./digest-panel";

export const dynamic = "force-dynamic";

export default function DigestPage() {
  return (
    <>
      <PageHeader
        eyebrow="Outbound"
        title="Digest"
        lede="The one push out of Throughline: a periodic summary of recent decisions, posted to your team's webhook. The worker sends it on schedule."
      />
      <DigestPanel />
    </>
  );
}
