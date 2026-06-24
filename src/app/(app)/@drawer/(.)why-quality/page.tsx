import { Suspense } from "react";
import { DrawerShell } from "@/components/drawer-shell";
import { WhyQualityPanel, WhyQualityLoading } from "../../why-quality/why-quality-panel";

export const dynamic = "force-dynamic";

export default async function WhyQualityDrawer({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  const { run } = await searchParams;
  return (
    <DrawerShell title="Why-quality">
      <Suspense key={run ?? "idle"} fallback={<WhyQualityLoading />}>
        <WhyQualityPanel run={run} />
      </Suspense>
    </DrawerShell>
  );
}
