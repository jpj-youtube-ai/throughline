import { DrawerShell } from "@/components/drawer-shell";
import { RequirementDetail } from "../../../spec/requirement-detail";

export const dynamic = "force-dynamic";

export default async function RequirementDrawer({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return (
    <DrawerShell title={key}>
      <RequirementDetail reqKey={key} />
    </DrawerShell>
  );
}
