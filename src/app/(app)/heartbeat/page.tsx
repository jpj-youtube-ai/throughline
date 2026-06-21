import { PageHeader } from "@/components/ui";
import { HeartbeatPanel } from "./heartbeat-panel";

export const dynamic = "force-dynamic";

export default function HeartbeatPage() {
  return (
    <>
      <PageHeader
        eyebrow="Cadence"
        title="Heartbeat"
        lede="The rhythm of decisions over the last 90 days — one bar per day, drawn from the log."
      />
      <HeartbeatPanel />
    </>
  );
}
