import { DrawerShell } from "@/components/drawer-shell";
import { SpecDocument } from "../../../spec/spec-document";

export const dynamic = "force-dynamic";

export default function SpecDocumentDrawer() {
  return (
    <DrawerShell title="SPEC.md">
      <SpecDocument />
    </DrawerShell>
  );
}
