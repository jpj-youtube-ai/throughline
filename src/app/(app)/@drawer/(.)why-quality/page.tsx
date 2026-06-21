import { DrawerShell } from "@/components/drawer-shell";
import { WhyQualityPanel } from "../../why-quality/why-quality-panel";

export const dynamic = "force-dynamic";

export default async function WhyQualityDrawer({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  const { run } = await searchParams;
  return (
    <DrawerShell title="Why-quality">
      <WhyQualityPanel run={run} />
    </DrawerShell>
  );
}
