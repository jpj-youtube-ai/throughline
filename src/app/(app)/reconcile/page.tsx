import { PageHeader } from "@/components/ui";
import { ReconcilePanel } from "./reconcile-panel";

export const dynamic = "force-dynamic";

export default function ReconcilePage() {
  return (
    <>
      <PageHeader
        eyebrow="Integrity"
        title="Reconciliation"
        lede="Does the spec still match the log and the code? Reconciliation reports divergence — it never rewrites the spec to match the code."
      />
      <ReconcilePanel />
    </>
  );
}
