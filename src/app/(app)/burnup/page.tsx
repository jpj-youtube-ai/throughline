import { PageHeader } from "@/components/ui";
import { BurnUpPanel } from "./burnup-panel";

export const dynamic = "force-dynamic";

export default function BurnupPage() {
  return (
    <>
      <PageHeader
        eyebrow="Progress"
        title="Burn-up"
        lede="Tasks created (scope) against tasks merged, over time — drawn from the log. Merges arrive from GitHub via webhook."
      />
      <BurnUpPanel />
    </>
  );
}
