import { getDb } from "@/db/client";
import { getLatestNarrative } from "@/narrative/queries";
import { Empty, buttonClass } from "@/components/ui";
import { regenerate } from "./actions";
import { activeProjectId } from "@/project/current";
import { RoadmapFrame } from "./roadmap-frame";

export async function NarrativePanel() {
  const pid = await activeProjectId();
  const n = await getLatestNarrative(getDb(), pid);

  return (
    <>
      {!n ? (
        <Empty title="No narrative yet.">Generate one and the project&apos;s history is written from the event log.</Empty>
      ) : (
        <>
          {n.roadmapHtml ? (
            <RoadmapFrame html={n.roadmapHtml} />
          ) : (
            <Empty title="Roadmap unavailable.">The last generation didn&apos;t produce a roadmap — regenerate to try again.</Empty>
          )}
          <footer className="mt-3 font-mono text-[11px] text-graphite">
            updated from {n.eventCount} events · {new Date(n.generatedAt).toLocaleString()}
          </footer>
        </>
      )}
      <form action={regenerate} className="mt-4">
        <button type="submit" className={buttonClass(n ? "quiet" : "primary")}>
          {n ? "Regenerate" : "Generate"}
        </button>
      </form>
    </>
  );
}
