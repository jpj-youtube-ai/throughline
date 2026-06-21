import { DrawerShell } from "@/components/drawer-shell";
import { IdeasPanel } from "../../ideas/ideas-panel";

export const dynamic = "force-dynamic";

export default function IdeasDrawer() {
  return (
    <DrawerShell title="Ideas in voting">
      <a href="/ideas/new" className="mb-4 inline-block text-sm text-spine-deep hover:underline">+ Submit an idea</a>
      <IdeasPanel />
    </DrawerShell>
  );
}
