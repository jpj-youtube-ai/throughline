import { PageHeader, buttonClass } from "@/components/ui";
import { IdeasPanel } from "./ideas-panel";

export const dynamic = "force-dynamic";

export default function IdeasPage() {
  return (
    <>
      <PageHeader
        eyebrow="Intake"
        title="Ideas in voting"
        lede="Two approvals carry an idea through the gate. Ideas left untended drift to the top — vote them up or let them go."
      >
        <a href="/ideas/new" className={buttonClass("primary")}>Submit an idea</a>
      </PageHeader>
      <IdeasPanel />
    </>
  );
}
